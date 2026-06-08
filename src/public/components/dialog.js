let dialog, dialogTitle, dialogBody, pendingResolve = null;

export function initDialog() {
  dialog = document.getElementById("confirm-dialog");
  dialogTitle = document.getElementById("confirm-title");
  dialogBody = document.getElementById("confirm-body");
  dialog.addEventListener("close", () => {
    if (pendingResolve) {
      const ok = dialog.returnValue === "ok";
      pendingResolve(ok);
      pendingResolve = null;
    }
  });
}

export function confirm(title, body) {
  return new Promise((resolve) => {
    if (pendingResolve) {
      // Avoid orphaning the prior resolver
      resolve(false);
      return;
    }
    dialogTitle.textContent = title;
    dialogBody.textContent = body;
    pendingResolve = resolve;
    dialog.showModal();
  });
}
