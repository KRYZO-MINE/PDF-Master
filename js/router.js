export function getRoute() {
  const path = location.hash.replace(/^#\/?/, "");
  const [section = "home", category] = path.split("/");
  return { section, category };
}

export function navigate(path) {
  location.hash = path ? `#${path}` : "#home";
}

export function listenToRoutes(callback) {
  window.addEventListener("hashchange", callback);
  callback();
}
