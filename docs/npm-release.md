# LocalApp npm 发布手册

`localapp` 是唯一面向用户的 npm 包。GitHub Actions 负责在 Linux、macOS Apple
Silicon、macOS Intel 和 Windows 上分别构建 native adapter，再把 CLI、统一 Server、
内置应用模板和四个平台 adapter 合并为一个 `localapp-<version>.tgz`。首发采用维护者
手动发布：CI 不保存 npm token，也不执行真实的 `npm publish`。

## 发布边界

- npm 包名固定为无 scope 的 `localapp`，可执行命令固定为 `localapp`。
- 只允许发布 GitHub Release 中由 CI 生成的四平台 tgz。开发机运行
  `npm run package:localapp` 得到的包只包含当前主机 adapter，不得发布。
- Git tag 必须严格等于 `v<packages/localapp/package.json 中的 version>`。
- npm 版本不可覆盖。任何发布后发现的问题都必须提升版本并重新构建。
- 首发与当前后续版本都由维护者登录 npm 后使用 2FA 手动确认；Trusted Publishing
  尚未启用。

## 1. 准备账户和仓库

维护者需要拥有 npmjs.com 账户、已启用发布操作的双因素认证，并确认自己有权发布
`localapp`。在首次发布前，名称查询通常返回 `E404`；发布过一次后则应显示当前版本：

```bash
npm config get registry
npm view localapp name version --registry https://registry.npmjs.org/
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
```

registry 必须是 `https://registry.npmjs.org/`。如果 `npm view` 显示不属于本项目的
同名包，立即停止，不要发布。

## 2. 准备版本提交

修改 `packages/localapp/package.json` 的 `version`，同步修正与该版本直接绑定的测试或
文档，然后在仓库根目录运行完整发布检查：

```bash
pnpm install --frozen-lockfile
pnpm test:localapp-package
pnpm test:release-workflow
pnpm test:release-manifest
pnpm test:brand
git diff --check
```

提交并 push `main` 后，确认本地提交就是远端 `main`，且发布 checkout 没有任何修改
或未跟踪文件：

```bash
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
test -z "$(git status --porcelain)"
```

## 3. 创建发布 tag

以下示例从包清单读取版本，避免手写错位：

```bash
version="$(node -p "require('./packages/localapp/package.json').version")"
tag="v${version}"
git tag -a "$tag" -m "LocalApp ${version}"
git push origin "$tag"
```

tag 会触发 `.github/workflows/release.yml`。等待 `source-gate`、四个平台的
`native-adapters`、`package` 和镜像任务全部通过。`package` 任务会先执行严格候选包
检查，再创建 GitHub Release、`localapp-<version>.tgz`、`release-manifest.json` 和
`SHA256SUMS`。

## 4. 下载并复验 CI 产物

所有临时文件放在仓库的 `tmp/` 下：

```bash
version="$(node -p "require('./packages/localapp/package.json').version")"
tag="v${version}"
release_dir="$PWD/tmp/npm-release-${version}"
mkdir -p "$release_dir"
gh release download "$tag" \
  --pattern "localapp-${version}.tgz" \
  --pattern "release-manifest.json" \
  --pattern "SHA256SUMS" \
  --dir "$release_dir"
cd "$release_dir"
shasum -a 256 -c SHA256SUMS
cd -
```

Linux 可将校验命令替换为 `sha256sum -c SHA256SUMS`。然后在仓库根目录对下载的同一个
tgz 执行 fail-closed 检查：

```bash
tgz="$release_dir/localapp-${version}.tgz"
pnpm release:npm:check -- --tarball "$tgz" --tag "$tag"
```

检查器验证包名、tag/版本、README、LICENSE、唯一 CLI、无 workspace 依赖和安装脚本、
四平台 adapter 矩阵与归档路径安全，并执行
`npm publish --dry-run --access public <tgz>`。它没有真实发布代码路径。

## 5. 手动发布到 npm

再次确认身份后，发布上一步已经校验的原始 tgz，不要重新打包：

```bash
npm whoami --registry https://registry.npmjs.org/
npm publish "$tgz" --access public --registry https://registry.npmjs.org/
```

npm 会按账户设置要求提示输入 2FA OTP。不要把 OTP、session token 或 npm 配置文件
提交到仓库，也不要用本地重新生成的 tgz 替换 CI 产物。

## 6. 发布后验收

registry 可能需要短暂传播。确认版本和 tarball 后，从仓库内的全新 prefix 安装：

```bash
npm view "localapp@${version}" name version dist.tarball dist.integrity \
  --registry https://registry.npmjs.org/
acceptance_dir="$PWD/tmp/npm-acceptance-${version}"
mkdir -p "$acceptance_dir"
npm install --prefix "$acceptance_dir" --ignore-scripts "localapp@${version}"
PATH="$acceptance_dir/node_modules/.bin:$PATH" localapp --version
PATH="$acceptance_dir/node_modules/.bin:$PATH" localapp server run --host 127.0.0.1 --port 0
```

最后一条命令应启动前台 Server；完成冒烟检查后用 `Ctrl-C` 停止。若发布失败且 npm
未创建该版本，可修复原因后重试同一 tgz；若 registry 已存在该版本，无论内容是否有
误都不得覆盖，必须提升版本、重新打 tag 并走完整流程。

## 后续 Trusted Publishing

迁移到 npm Trusted Publishing/OIDC 是独立变更：需要在 npm 中绑定本仓库和指定
workflow，最小化 GitHub `id-token` 权限，保留相同候选包检查与 provenance 验证，并
经过单独评审后才能让 CI 执行真实发布。在此之前，Release workflow 必须保持无 npm
凭据、无 `id-token: write`、无真实 `npm publish`。
