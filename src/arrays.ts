/** Append histories without turning every record into a function argument. */
export function appendItems<T>(target: T[], items: Iterable<T>): void {
  for (const item of items) target.push(item);
}
