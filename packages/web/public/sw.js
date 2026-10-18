// Venviewer service worker (goal 19 S7): web push only. It caches nothing
// and never answers a fetch; the Day Board keeps its own offline queue. A
// push shows the notice the API sent, replacing an earlier one about the
// same request; a tap opens the page the notice names, in a window already
// open where there is one.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let notice = null;
  try {
    notice = event.data ? event.data.json() : null;
  } catch {
    notice = null;
  }
  if (notice === null || typeof notice.title !== "string") return;
  const url = typeof notice.url === "string" ? notice.url : "/hallkeeper/today";
  event.waitUntil(self.registration.showNotification(notice.title, {
    body: typeof notice.body === "string" ? notice.body : "",
    tag: typeof notice.tag === "string" ? notice.tag : undefined,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url, event: notice.event },
    renotify: true,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url
    : "/hallkeeper/today";
  const target = new URL(url, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ("focus" in client && client.url.startsWith(self.location.origin)) {
        return client.navigate ? client.navigate(target).then((navigated) => (navigated ?? client).focus()) : client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
