import { ExternalLink, Heart, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDesktopGateway } from "../lib/desktop-gateway";
import type { Favorite } from "../lib/types";

export function FavoritesView() {
  const gateway = getDesktopGateway();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [removingFavoriteId, setRemovingFavoriteId] = useState<number>();
  const [openingFavoriteId, setOpeningFavoriteId] = useState<number>();
  const [error, setError] = useState<string>();
  const [canRetryLoad, setCanRetryLoad] = useState(false);
  const requestGeneration = useRef(0);

  const visibleFavorites = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return favorites;

    return favorites.filter((favorite) =>
      [favorite.pageName, favorite.ownerName, favorite.appPath]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }, [favorites, search]);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setIsLoading(true);
    setError(undefined);
    setCanRetryLoad(false);

    try {
      const items = await gateway.listFavorites();
      if (generation !== requestGeneration.current) return;
      setFavorites(items);
    } catch {
      if (generation !== requestGeneration.current) return;
      setError("无法加载收藏，请检查连接后重试。");
      setCanRetryLoad(true);
    } finally {
      if (generation === requestGeneration.current) setIsLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openFavorite(favorite: Favorite) {
    if (openingFavoriteId || removingFavoriteId) return;
    setOpeningFavoriteId(favorite.id);
    setError(undefined);
    setCanRetryLoad(false);

    try {
      await gateway.openApp(favorite.appPath);
    } catch {
      setError("无法打开应用，请重试。");
    } finally {
      setOpeningFavoriteId(undefined);
    }
  }

  async function removeFavorite(favorite: Favorite) {
    if (removingFavoriteId || openingFavoriteId) return;
    const index = favorites.findIndex((entry) => entry.id === favorite.id);
    if (index < 0) return;

    requestGeneration.current += 1;
    setRemovingFavoriteId(favorite.id);
    setError(undefined);
    setCanRetryLoad(false);
    setFavorites((current) => current.filter((entry) => entry.id !== favorite.id));

    try {
      await gateway.removeFavorite(favorite.storedPagePath);
    } catch {
      setFavorites((current) => [
        ...current.slice(0, index),
        favorite,
        ...current.slice(index),
      ]);
      setError("无法移除收藏，请重试。");
    } finally {
      setRemovingFavoriteId(undefined);
    }
  }

  return (
    <div className="view-stack favorites-view">
      <div className="favorites-heading">
        <div className="page-heading">
          <h1>收藏</h1>
          <p>快速打开你常用的 LocalApp 应用。</p>
        </div>
        <button
          aria-label="刷新收藏"
          className="icon-button"
          disabled={isLoading || Boolean(removingFavoriteId) || Boolean(openingFavoriteId)}
          onClick={() => void load()}
          title="刷新收藏"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={18} />
        </button>
      </div>

      <label className="favorites-search">
        <span className="sr-only">搜索收藏</span>
        <input
          aria-label="搜索收藏"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索收藏"
          role="searchbox"
          type="search"
          value={search}
        />
      </label>

      {error ? (
        <div className="message-error" role="alert">
          <span>{error}</span>
          {canRetryLoad ? (
            <button className="text-button" onClick={() => void load()} type="button">
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading && favorites.length === 0 ? <FavoritesLoading /> : null}
      {!isLoading && favorites.length === 0 && !error ? <FavoritesEmpty /> : null}
      {favorites.length > 0 && visibleFavorites.length === 0 ? <FavoritesNoResults /> : null}
      {visibleFavorites.length > 0 ? (
        <section aria-label="收藏列表" className="favorites-list">
          {visibleFavorites.map((favorite) => {
            const name = favorite.pageName ?? favorite.appPath;
            const owner = favorite.ownerName ?? ownerFromAppPath(favorite.appPath);
            const isBusy = favorite.id === removingFavoriteId || favorite.id === openingFavoriteId;

            return (
              <article className="favorite-row" key={favorite.id}>
                <div className="favorite-content">
                  <h2>{name}</h2>
                  <div className="favorite-meta">
                    <span>{owner}</span>
                    <code>{favorite.appPath}</code>
                  </div>
                </div>
                <div className="favorite-row-actions">
                  <button
                    aria-label={`打开 ${name}`}
                    className="icon-button"
                    disabled={isBusy || Boolean(removingFavoriteId) || Boolean(openingFavoriteId)}
                    onClick={() => void openFavorite(favorite)}
                    title={`打开 ${name}`}
                    type="button"
                  >
                    <ExternalLink aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label={`移除 ${name}`}
                    className="icon-button"
                    disabled={isBusy || Boolean(removingFavoriteId) || Boolean(openingFavoriteId)}
                    onClick={() => void removeFavorite(favorite)}
                    title={`移除 ${name}`}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function ownerFromAppPath(appPath: string): string {
  return appPath.split("/")[1] || "未知创建者";
}

function FavoritesLoading() {
  return (
    <section aria-label="正在加载收藏" className="favorites-list favorites-list-loading">
      {[0, 1, 2].map((item) => <div className="favorite-skeleton" key={item} />)}
    </section>
  );
}

function FavoritesEmpty() {
  return (
    <section className="empty-state" aria-label="收藏为空">
      <Heart aria-hidden="true" size={26} strokeWidth={1.6} />
      <h2>还没有收藏</h2>
      <p>在浏览器中收藏应用后，它们会出现在这里。</p>
    </section>
  );
}

function FavoritesNoResults() {
  return (
    <section className="empty-state" aria-label="没有匹配的收藏">
      <Heart aria-hidden="true" size={26} strokeWidth={1.6} />
      <h2>没有匹配的收藏</h2>
      <p>尝试搜索应用名称、创建者或路径。</p>
    </section>
  );
}
