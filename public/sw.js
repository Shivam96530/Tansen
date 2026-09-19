// Tansen Background Audio Service Worker
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "UPDATE_PLAYING") {
    const { track, isPlaying } = data;
    if (!track) {
      self.registration.getNotifications().then((notifications) => {
        notifications.forEach((n) => n.close());
      });
      return;
    }

    const title = track.title || "Tansen Music";
    const options = {
      body: `${track.artist || "Unknown Artist"} · Tansen`,
      icon: track.thumbnail || "/favicon.svg",
      badge: "/favicon.svg",
      tag: "tansen-playback",
      renotify: false,
      silent: true,
      requireInteraction: Boolean(isPlaying),
      actions: [
        { action: "prev", title: "⏮ Prev" },
        { action: isPlaying ? "pause" : "play", title: isPlaying ? "⏸ Pause" : "▶ Play" },
        { action: "next", title: "⏭ Next" },
      ],
      data: { trackId: track.id, isPlaying: Boolean(isPlaying) },
    };

    self.registration.showNotification(title, options).catch(() => {});
  } else if (data.type === "STOP_PLAYING") {
    self.registration.getNotifications().then((notifications) => {
      notifications.forEach((n) => n.close());
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  const notif = event.notification;

  if (action === "play" || action === "pause") {
    const isNowPlaying = action === "play";
    self.registration
      .showNotification(notif.title, {
        body: notif.body,
        icon: notif.icon,
        badge: "/favicon.svg",
        tag: "tansen-playback",
        renotify: false,
        silent: true,
        requireInteraction: isNowPlaying,
        actions: [
          { action: "prev", title: "⏮ Prev" },
          { action: isNowPlaying ? "pause" : "play", title: isNowPlaying ? "⏸ Pause" : "▶ Play" },
          { action: "next", title: "⏭ Next" },
        ],
        data: notif.data,
      })
      .catch(() => {});
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        clientList.forEach((client) => {
          client.postMessage({ type: "SW_ACTION", action });
        });
        if (!action) {
          return clientList[0].focus();
        }
      } else if (!action) {
        return self.clients.openWindow("/");
      }
    })
  );
});
