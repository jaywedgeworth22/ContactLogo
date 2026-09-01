const DISMISS_KEY = "contactlogo.swUpdate.dismissed";

export function shouldOfferWaitingWorker(args: {
  waiting: boolean;
  dismissed: boolean;
}): boolean {
  return args.waiting && !args.dismissed;
}

export function isSessionDismissed(storage: Storage | null | undefined = defaultSessionStorage()): boolean {
  try {
    return storage?.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberSessionDismiss(storage: Storage | null | undefined = defaultSessionStorage()): void {
  try {
    storage?.setItem(DISMISS_KEY, "1");
  } catch {
    // Fail silent when storage is blocked.
  }
}

function defaultSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function mountUpdateBanner(onReload: () => void, onDismiss: () => void): { show: () => void; hide: () => void } {
  let host = document.getElementById("contactlogo-update-banner");
  if (!host) {
    host = document.createElement("div");
    host.id = "contactlogo-update-banner";
    host.className = "update-banner";
    host.hidden = true;
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");

    const copy = document.createElement("div");
    copy.className = "update-banner-copy";
    const title = document.createElement("strong");
    title.textContent = "Update Available";
    const message = document.createElement("span");
    message.textContent = "A newer ContactLogo is ready.\u00A0 Reload to use it.";
    copy.append(title, message);

    const actions = document.createElement("div");
    actions.className = "update-banner-actions";
    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "btn";
    reload.textContent = "Update";
    reload.addEventListener("click", onReload);
    const later = document.createElement("button");
    later.type = "button";
    later.className = "btn ghost";
    later.textContent = "Not Now";
    later.addEventListener("click", onDismiss);
    actions.append(reload, later);

    host.append(copy, actions);
    document.body.prepend(host);
  }

  return {
    show() {
      host.hidden = false;
    },
    hide() {
      host.hidden = true;
    },
  };
}

function listenForWaitingWorker(
  registration: ServiceWorkerRegistration,
  onWaiting: (worker: ServiceWorker) => void,
): void {
  const notify = (worker: ServiceWorker | null | undefined) => {
    if (worker) onWaiting(worker);
  };

  notify(registration.waiting);

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") {
        notify(registration.waiting ?? installing);
      }
    });
  });
}

export function startWebUpdatePrompt(): void {
  if (!("serviceWorker" in navigator)) return;

  const start = () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        void registration.update();

        let reloading = false;
        const banner = mountUpdateBanner(
          () => {
            const waiting = registration.waiting;
            if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
            if (!reloading) {
              reloading = true;
              window.location.reload();
            }
          },
          () => {
            rememberSessionDismiss();
            banner.hide();
          },
        );

        const offerIfNeeded = (worker: ServiceWorker) => {
          if (
            shouldOfferWaitingWorker({
              waiting: Boolean(worker),
              dismissed: isSessionDismissed(),
            })
          ) {
            banner.show();
          }
        };

        listenForWaitingWorker(registration, offerIfNeeded);
        if (new URLSearchParams(window.location.search).get("forceUpdateBanner") === "1") {
          banner.show();
        }
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });
      } catch {
        // Fail silent.  A missing or blocked worker must not break the app.
      }
    })();
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
}
