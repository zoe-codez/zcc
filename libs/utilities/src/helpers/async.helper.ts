import { is } from "../extensions/is.extension";
import { ARRAY_OFFSET, START } from "./utilities.helper.js";

// ? Functions written to be similar to the offerings from the async library
// That library gave me oddly inconsistent results,
//     so these exist to replace those doing exactly what I expect
//

export async function each<T = unknown>(
  item: T[] = [],
  callback: (item: T) => Promise<void | unknown>,
): Promise<void> {
  await Promise.all(item.map(async i => await callback(i)));
}

export async function eachSeries<T = void>(
  item: T[] | Set<T>,
  callback: (item: T) => Promise<void | unknown>,
): Promise<void> {
  if (item instanceof Set) {
    item = [...item.values()];
  }
  if (!is.array(item)) {
    throw new TypeError(`Not provided an array`);
  }
  for (let i = START; i <= item.length - ARRAY_OFFSET; i++) {
    await callback(item[i]);
  }
}