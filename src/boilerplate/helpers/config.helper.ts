import { is } from "../..";
import { ServiceMap, ZCCApplicationDefinition } from "./wiring.helper";

export type CodeConfigDefinition = Record<string, AnyConfig>;
export type ZccConfigTypes =
  | "string"
  | "boolean"
  | "internal"
  | "number"
  | "record"
  | "string[]";
export type AnyConfig =
  | StringConfig<string>
  | BooleanConfig
  | InternalConfig<unknown>
  | NumberConfig
  | RecordConfig
  | StringArrayConfig;
export interface BaseConfig {
  /**
   * If no other values are provided, what value should be injected?
   * This ensures a value is always provided, and checks for undefined don't need to happen
   */
  default?: unknown;
  /**
   * Short descriptive text so humans can understand why this exists.
   */
  description?: string | string[];
  /**
   * Refuse to boot if user provided value is not present.
   */
  required?: boolean;

  type: ZccConfigTypes;
}
export type KnownConfigs = Map<string | symbol, CodeConfigDefinition>;
export interface StringConfig<STRING extends string> extends BaseConfig {
  default?: STRING;
  /**
   * If provided, the value **MUST** appear in this list or the application will refuse to boot.
   */
  enum?: STRING[];
  type: "string";
}

export interface BooleanConfig extends BaseConfig {
  default?: boolean;
  type: "boolean";
}

/**
 * For configurations that just can't be expressed any other way.
 * Make sure to add a helpful description on how to format the value,
 * because `config-builder` won't be able to help.
 *
 * This can be used to take in a complex json object, and forward the information to another library.
 *
 * TODO: JSON schema magic for validation / maybe config builder help
 */
export type InternalConfig<VALUE extends unknown> = BaseConfig & {
  default: VALUE;
  type: "internal";
};

export interface NumberConfig extends BaseConfig {
  default?: number;
  type: "number";
}

/**
 * key/value pairs
 */
export interface RecordConfig extends BaseConfig {
  type: "record";
}

export interface StringArrayConfig extends BaseConfig {
  default?: string[];
  type: "string[]";
}

/**
 * Used with config scanner
 */
export interface ConfigDefinitionDTO {
  application: string;
  bootstrapOverrides?: AbstractConfig;
  config: ConfigTypeDTO[];
}

export interface ConfigTypeDTO<METADATA extends AnyConfig = AnyConfig> {
  /**
   * Name of project
   */
  library: string;
  /**
   * Description of a single config item as passed into the module
   */
  metadata: METADATA;
  /**
   * Property name
   */
  property: string;
}

/**
 * Top level configuration object
 *
 * Extends the global common config, adding a section for the top level application to chuck in data without affecting things
 * Also provides dedicated sections for libraries to store their own configuration options
 */
export interface AbstractConfig {}
export type ConfigLoaderReturn = Promise<Partial<AbstractConfig>>;

export type ConfigLoader = [
  loader: <S extends ServiceMap, C extends OptionalModuleConfiguration>(
    application: ZCCApplicationDefinition<S, C>,
    definedConfigurations: KnownConfigs,
  ) => ConfigLoaderReturn,
  priority: number,
];

export function cast<T = unknown>(data: string | string[], type: string): T {
  switch (type) {
    case "boolean": {
      data ??= "";
      return (
        is.boolean(data)
          ? data
          : ["true", "y", "1"].includes((data as string).toLowerCase())
      ) as T;
    }
    case "number":
      return Number(data) as T;
    case "string[]":
      if (is.undefined(data)) {
        return [] as T;
      }
      if (is.array(data)) {
        return data.map(String) as T;
      }
      // This occurs with cli switches
      // If only 1 is passed, it'll get the value
      // ex: --foo=bar  ==== {foo:'bar'}
      // If duplicates are passed, will receive array
      // ex: --foo=bar --foo=baz === {foo:['bar','baz']}
      return [String(data)] as T;
  }
  return data as T;
}

export type ModuleConfiguration = {
  [key: string]: AnyConfig;
};
export type OptionalModuleConfiguration = ModuleConfiguration | undefined;