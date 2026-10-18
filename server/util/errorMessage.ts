/** Text with line breaks removed, so it can't forge extra log lines (log injection). */
export function singleLine(text: string): string {
  return text.replace(/[\n\r]/g, '');
}

/** Single-line error text that is safe to log (no CR/LF for log injection). */
export function errorMessage(err: unknown): string {
  let text = 'unknown error';
  if (err instanceof Error) text = err.message;
  else if (typeof err === 'string') text = err;
  return singleLine(text);
}
