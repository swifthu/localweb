let dialog, dialogTitle, dialogBody;
let pendingResolvers = [];

export function initDialog() {
  dialog = document.getElementById("confirm-dialog");
  dialogTitle = document.getElementById("confirm-title");
  dialogBody = document.getElementById("confirm-body");
  dialog.addEventListener("close", () => {
    const ok = dialog.returnValue === "ok";
    const resolvers = pendingResolvers;
    pendingResolvers = [];
    for (const r of resolvers) r(ok);
  });
}

export function confirm(title, body) {
  return new Promise((resolve) => {
    if (pendingResolvers.length > 0) {
      // Dialog is busy: queue this request
      pendingResolvers.push(resolve);
      return;
    }
    pendingResolvers.push(resolve);
    dialogTitle.textContent = title;
    dialogBody.textContent = body;
    dialog.showModal();
  });
}
