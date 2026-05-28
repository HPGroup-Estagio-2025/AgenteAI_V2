const g = globalThis;
if (!g._sseClients) g._sseClients = new Set();
const encoder = new TextEncoder();

export function addClient(controller) {
  g._sseClients.add(controller);
}

export function removeClient(controller) {
  g._sseClients.delete(controller);
}

export function notifyClients() {
  for (const controller of g._sseClients) {
    try {
      controller.enqueue(encoder.encode('data: update\n\n'));
    } catch {
      g._sseClients.delete(controller);
    }
  }
}
