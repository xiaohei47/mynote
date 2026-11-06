// Runs inside the opaque-origin iframe. It receives only this HTML attachment's state.
export function htmlRuntime() {
  type State = { revision: string; tasks: Record<string, unknown>[] };
  type Workbench = Window & { initDB?: () => Promise<void>; getAllTasks?: () => Promise<unknown[]>; addTask?: (task: Record<string, unknown>) => Promise<void>; updateTask?: (task: Record<string, unknown>) => Promise<void>; deleteTask?: (id: string) => Promise<void>; removeTask?: (id: string) => Promise<void>; renderTasks?: () => Promise<void> };
  const page = window as Workbench;
  let port: MessagePort, state: State = { revision: '', tasks: [] }, counter = 0;
  let resolveReady: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  function rpc(method: string, payload: unknown): Promise<unknown> {
    return ready.then(() => new Promise((resolve, reject) => {
      const id = ++counter; pending.set(id, { resolve, reject }); port.postMessage({ id, method, payload });
      setTimeout(() => { if (pending.delete(id)) reject(Error('操作超时，请重试。')); }, 30000);
    }));
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'shiye-html-init' || !event.ports[0] || port) return;
    port = event.ports[0];
    state = event.data.state || { revision: '', tasks: [] };
    port.onmessage = event => {
      const request = pending.get(event.data?.id); if (!request) return;
      pending.delete(event.data.id);
      if (event.data.error) request.reject(Error(event.data.error)); else request.resolve(event.data.value);
    };
    resolveReady();
  });
  Object.defineProperty(window, 'open', { value: (url: string | URL) => { void rpc('open', String(url)).catch(error => alert(error.message)); return null; }, writable: false, configurable: false });
  Object.defineProperty(window, 'alert', { value: (text: unknown) => { void rpc('alert', String(text)); }, writable: false, configurable: false });
  try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (text: string) => rpc('copy', text) }, configurable: false }); } catch {}
  document.addEventListener('click', event => {
    const link = (event.target as Element)?.closest?.('a');
    if (link && !link.hasAttribute('download') && !link.getAttribute('href')?.startsWith('#')) { event.preventDefault(); if (link.href && !link.getAttribute('href')?.startsWith('#')) void rpc('open', link.href).catch(error => alert(error.message)); }
  }, true);
  window.addEventListener('load', () => {
    // Adapter for the supplied business workbench; other HTML remains an isolated preview.
    if (!document.getElementById('regionList') || !document.getElementById('todoList') || !page.initDB || !page.getAllTasks || !page.addTask || !page.updateTask || !page.deleteTask) return;
    let queue = Promise.resolve();
    function mutate(change: (tasks: Record<string, unknown>[]) => void): Promise<void> {
      const job = queue.then(async () => {
        await ready; const tasks = structuredClone(state.tasks); change(tasks);
        state = await rpc('save-tasks', { tasks, expectedRevision: state.revision || undefined }) as State;
      });
      queue = job.catch(() => {}); return job;
    }
    page.initDB = () => ready;
    page.getAllTasks = async () => { await ready; return structuredClone(state.tasks); };
    page.addTask = task => mutate(tasks => { if (tasks.some(t => t.id === task.id)) throw new DOMException('任务已存在', 'ConstraintError'); tasks.push(structuredClone(task)); });
    page.updateTask = task => mutate(tasks => { const index = tasks.findIndex(t => t.id === task.id); if (index === -1) tasks.push(structuredClone(task)); else tasks[index] = structuredClone(task); });
    page.deleteTask = id => mutate(tasks => { const index = tasks.findIndex(t => t.id === id); if (index !== -1) tasks.splice(index, 1); });
    if (page.removeTask && page.renderTasks) page.removeTask = async id => { if (await rpc('confirm', '确定删除此任务？')) { await page.deleteTask!(id); await page.renderTasks!(); } };
  }, { once: true });
}
