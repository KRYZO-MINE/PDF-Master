const KEYS = {
  favorites: "pdf-master:favorites",
  recent: "pdf-master:recent"
};

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.warn(`Could not read local setting "${key}".`, error);
    return [];
  }
}

export function getFavorites() {
  return readList(KEYS.favorites);
}

export function toggleFavorite(id) {
  const favorites = getFavorites();
  const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
  localStorage.setItem(KEYS.favorites, JSON.stringify(next));
  return next;
}

export function getRecent() {
  return readList(KEYS.recent);
}

export function addRecent(id) {
  const recent = [id, ...getRecent().filter((item) => item !== id)].slice(0, 5);
  localStorage.setItem(KEYS.recent, JSON.stringify(recent));
  return recent;
}
