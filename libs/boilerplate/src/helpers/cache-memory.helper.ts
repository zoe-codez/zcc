import { is } from "@zcc/utilities";
import NodeCache from "node-cache";

import { ICacheDriver } from "../extensions/cache.extension";
import { LIB_BOILERPLATE } from "../extensions/wiring.extension";
import { MEMORY_CACHE_ERROR_COUNT } from "./metrics.helper";
import { TServiceParams } from "./wiring.helper";

/**
 * url & name properties automatically generated from config
 */
export function createMemoryDriver(
  { logger }: Pick<TServiceParams, "logger">,
  options?: NodeCache.Options,
): ICacheDriver {
  const client = new NodeCache({
    stdTTL: LIB_BOILERPLATE.getConfig("CACHE_TTL"),
    ...options,
  });

  return {
    async del(key: string) {
      try {
        client.del(key);
      } catch (error) {
        logger.error({ err: error }, "Error in Memory Cache del operation");
        MEMORY_CACHE_ERROR_COUNT.inc();
      }
    },
    async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
      try {
        const out = client.get(key);
        if (is.string(out)) {
          return JSON.parse(out) as T;
        }
        return defaultValue;
      } catch (error) {
        logger.error({ err: error }, "Error in Memory Cache get operation");
        MEMORY_CACHE_ERROR_COUNT.inc();
        return defaultValue;
      }
    },
    async keys(pattern?: string) {
      try {
        const allKeys = client.keys();
        return pattern
          ? allKeys.filter(key => new RegExp(pattern).test(key))
          : allKeys;
      } catch (error) {
        logger.error({ err: error }, "Error in Memory Cache keys operation");
        MEMORY_CACHE_ERROR_COUNT.inc();
        return [];
      }
    },
    async set<T>(key: string, value: T, ttl: number) {
      try {
        client.set(key, JSON.stringify(value), ttl);
      } catch (error) {
        logger.error({ err: error }, "Error in Memory Cache set operation");
        MEMORY_CACHE_ERROR_COUNT.inc();
      }
    },
  };
}