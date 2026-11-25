const AD_CLIENT = document.documentElement.dataset.adsenseClient || "";

export function initializeAds() {
  const slots = [...document.querySelectorAll("[data-ad-slot-id]")];
  if (!AD_CLIENT || !slots.length) return;
  for (const slot of slots) slot.hidden = true;

  const loadConfiguredAds = () => {
    if (!navigator.onLine || document.querySelector("[data-active-editor]")) return;
    const configuredSlots = slots.filter((slot) => slot.dataset.adSlotId);
    if (!configuredSlots.length) return;
    for (const slot of configuredSlots) {
      if (!slot.isConnected || slot.querySelector(".adsbygoogle")) continue;
      const ad = document.createElement("ins");
      ad.className = "adsbygoogle";
      ad.style.display = "block";
      ad.dataset.adClient = AD_CLIENT;
      ad.dataset.adSlot = slot.dataset.adSlotId;
      ad.dataset.adFormat = "auto";
      ad.dataset.fullWidthResponsive = "true";
      slot.append(ad);
    }
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(AD_CLIENT)}`;
    script.addEventListener("load", () => {
      for (const slot of configuredSlots.filter((item) => item.isConnected)) {
        slot.hidden = false;
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
      }
    }, { once: true });
    script.addEventListener("error", () => {
      for (const slot of configuredSlots) slot.hidden = true;
      script.remove();
    }, { once: true });
    document.head.append(script);
  };
  window.addEventListener("online", loadConfiguredAds);
  window.addEventListener("offline", () => {
    for (const slot of slots) slot.hidden = true;
  });
  loadConfiguredAds();
}
