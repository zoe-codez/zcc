import { FIRST, is, ZCC } from "@zcc/utilities";
import Bottleneck from "bottleneck";

import {
  FetchRequestError,
  MaybeHttpError,
} from "../helpers/errors.helper.mjs";
import {
  FetchArguments,
  FetchParameterTypes,
  FetchProcessTypes,
  FetchWith,
  ResultControl,
} from "../helpers/fetch.helper.mjs";
import {
  FETCH_REQUEST_BOTTLENECK_DELAY,
  FETCH_REQUESTS_FAILED,
  FETCH_REQUESTS_INITIATED,
  FETCH_REQUESTS_SUCCESSFUL,
} from "../helpers/metrics.helper.mjs";
import { TServiceParams } from "../helpers/wiring.helper.mjs";

/**
 * Properties that alter the way that fetcher works.
 */
type FetcherOptions = {
  /**
   * typically domain names with scheme, added to the front of urls if the individual request doesn't override
   */
  baseUrl?: string;
  /**
   * if provided, then requests will be rate limited via the bottleneck library
   */
  bottleneck?: Bottleneck.ConstructorOptions;
  /**
   * merged into every request
   */
  headers?: Record<string, string>;
  /**
   * Alter the context attached to the log statements emitted from the fetcher
   */
  logContext?: string;
};

// type DownloadOptions = Partial<FetchArguments> & { destination: string };

function cast(item: FetchParameterTypes): string {
  if (is.array(item)) {
    return item.map(i => cast(i)).join(",");
  }
  if (item instanceof Date) {
    return item.toISOString();
  }
  if (is.number(item)) {
    return item.toString();
  }
  if (is.boolean(item)) {
    return item ? "true" : "false";
  }
  return item;
}

export type TFetchBody = object | undefined;

function buildFilterString(
  fetchWith: FetchWith<{
    filters?: Readonly<ResultControl>;
    params?: Record<string, FetchParameterTypes>;
  }>,
): string {
  return new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(fetchWith.params ?? {}).map(([label, value]) => [
        label,
        cast(value),
      ]),
    ),
  }).toString();
}

export function ZCC_Fetch({ logger }: TServiceParams) {
  const createFetcher = ({
    bottleneck,
    headers: baseHeaders,
    baseUrl,
    logContext,
    // eslint-disable-next-line sonarjs/cognitive-complexity
  }: FetcherOptions) => {
    const extras: Record<string, string> = {};
    if (!is.empty(logContext)) {
      extras.context = logContext;
    }
    let limiter: Bottleneck;
    const capabilities: string[] = [];
    if (bottleneck) {
      capabilities.push("bottleneck");
      limiter = new Bottleneck(bottleneck);
    }
    if (!is.empty(capabilities)) {
      logger.trace({ capabilities, ...extras }, `Initialized fetcher`);
    }

    function checkForHttpErrors<T extends unknown = unknown>(
      maybeError: MaybeHttpError,
    ): T {
      if (
        is.object(maybeError) &&
        maybeError !== null &&
        is.number(maybeError.statusCode) &&
        is.string(maybeError.error)
      ) {
        // Log the error if needed
        logger.error({ error: maybeError, ...extras }, maybeError.message);

        // Throw a FetchRequestError
        // throw new FetchRequestError(maybeError);
        throw new FetchRequestError(
          maybeError.statusCode,
          maybeError.error,
          maybeError.message,
        );
      }

      return maybeError as T;
    }

    async function fetchHandleResponse<T extends unknown = unknown>(
      process: FetchProcessTypes,
      response: Response,
    ): Promise<T> {
      if (process === false || process === "raw") {
        return response as T;
      }
      const text = await response.text();
      if (process === "text") {
        return text as unknown as T;
      }
      if (!["{", "["].includes(text.charAt(FIRST))) {
        if (["OK"].includes(text)) {
          logger.debug({ text, ...extras }, "Full response text");
        } else {
          // It's probably a coding error error, and not something a user did.
          // Will try to keep the array up to date if any other edge cases pop up
          logger.warn({ text, ...extras }, `Unexpected API Response`);
        }
        return text as T;
      }
      const parsed = JSON.parse(text);
      return checkForHttpErrors<T>(parsed);
    }

    function fetchCreateUrl({ rawUrl, url, ...fetchWith }: FetchWith): string {
      let out = url || "";
      if (!rawUrl) {
        const base = fetchWith.baseUrl || baseUrl;
        out = base + url;
      }
      if (!is.empty(fetchWith.params)) {
        out = `${out}?${buildFilterString(fetchWith)}`;
      }
      return out;
    }

    async function execFetch<T, BODY extends TFetchBody = undefined>({
      body,
      headers = {},
      method = "get",
      process,
      ...fetchWith
    }: Partial<FetchArguments<BODY>>) {
      const url = fetchCreateUrl(fetchWith);
      try {
        const result = await fetch(url, {
          body: is.object(body) ? JSON.stringify(body) : body,
          headers: {
            ...baseHeaders,
            ...headers,
          },
          method,
        });
        const out = await fetchHandleResponse<T>(process, result);
        FETCH_REQUESTS_SUCCESSFUL.inc();
        return out;
      } catch (error) {
        logger.error({ error, ...extras }, `Request failed`);
        FETCH_REQUESTS_FAILED.inc();
        throw error;
      }
    }

    return {
      // !! TODO: implement later.
      // !! Some fetch internals changed in refactor, and this isn't important enough right now to be worth solving
      // !! ----
      // download: async ({ destination, ...fetchWith }: DownloadOptions) => {
      //   const url: string = await fetchCreateUrl(fetchWith);
      //   const requestInit = await fetchCreateMeta(fetchWith);
      //   const response = await fetch(url, requestInit);

      //   await new Promise<void>((resolve, reject) => {
      //     if (!response?.body) {
      //       return;
      //     }
      //     const fileStream = createWriteStream(destination);
      //     response.body.pipeThrough(fileStream);
      //     response.body.on("error", error => reject(error));
      //     fileStream.on("finish", () => resolve());
      //   });
      // },
      fetch: async <T, BODY extends TFetchBody = undefined>(
        fetchWith: Partial<FetchArguments<BODY>>,
      ): Promise<T | undefined> => {
        FETCH_REQUESTS_INITIATED.inc();
        if (limiter) {
          const start = Date.now();
          return limiter.schedule(async () => {
            FETCH_REQUEST_BOTTLENECK_DELAY.set(Date.now() - start);
            return await execFetch(fetchWith);
          });
        }
        return await execFetch(fetchWith);
      },
    };
  };
  ZCC.createFetcher = createFetcher;
  const globalFetch = createFetcher({
    logContext: "ZCC:fetch",
  });
  ZCC.fetch = globalFetch.fetch;
  return createFetcher;
}

export type TFetch = <T, BODY extends object = undefined>(
  fetchWith: Partial<FetchArguments<BODY>>,
) => Promise<T>;

declare module "@zcc/utilities" {
  export interface ZCCDefinition {
    createFetcher: (options: FetcherOptions) => {
      fetch: TFetch;
    };
    fetch: TFetch;
  }
}
