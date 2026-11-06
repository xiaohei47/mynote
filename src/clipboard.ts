export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const textarea = document.createElement('textarea');
    textarea.value = text; document.body.append(textarea); textarea.select();
    const copied = document.execCommand('copy'); textarea.remove();
    if (!copied) throw Error('复制失败，请手动复制。');
  }
}
