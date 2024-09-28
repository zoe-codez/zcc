import { AsyncLocalStorage } from "async_hooks";
import { v4 } from "uuid";

import { AlsExtension, AsyncLocalData, AsyncLogData, TBlackHole, TServiceParams } from "../helpers";

export function ALS({ config }: TServiceParams): AlsExtension {
  const storage = new AsyncLocalStorage<AsyncLocalData>();
  return {
    asyncStorage: () => (config.boilerplate.NODE_ENV ? storage : undefined),
    getLogData: () => storage.getStore()?.logs ?? ({} as AsyncLogData),
    getStore: () => storage.getStore(),
    init(source: object, callback: () => TBlackHole) {
      const data = { logs: { id: v4(), ...source } };
      storage.run(data as AsyncLocalData, () => {
        callback();
      });
    },
  };
}