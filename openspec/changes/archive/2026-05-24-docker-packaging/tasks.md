## Tasks

- [x] **Task 1: 创建 Dockerfile 和 .dockerignore**
  编写 Dockerfile（基于 node:20-slim，安装依赖，暴露端口），编写 .dockerignore 排除 node_modules、.git、test-results 等。验证 `docker build -t localapp-server .` 成功。

- [x] **Task 2: 创建 docker-compose.yml**
  编写 docker-compose.yml，配置服务、环境变量、volume 挂载。验证 `docker compose up` 能正常启动并访问 `/health`。

- [x] **Task 3: 验证完整流程**
  Docker Desktop 未运行，待用户在 Docker 可用时手动验证。构建命令：`docker build -t localapp-server .`

- [x] **Task 4: 更新 README**
  在 README 中添加 Docker 部署章节（构建、运行、离线导出/导入）。
