import { DOWN, each, eachSeries, is, UP, ZCC } from "@zcc/utilities";
import { EventEmitter } from "eventemitter3";
import { exit } from "process";

import { LIB_BOILERPLATE } from "../boilerplate.module.mjs";
import {
  BootstrapException,
  InternalError,
} from "../helpers/errors.helper.mjs";
import { ZCC_LIBRARY_ERROR } from "../helpers/events.helper.mjs";
import {
  LifecycleCallback,
  TParentLifecycle,
} from "../helpers/lifecycle.helper.mjs";
import {
  ApplicationConfigurationOptions,
  ApplicationDefinition,
  BootstrapOptions,
  LibraryConfigurationOptions,
  Loader,
  TModuleMappings,
  TResolvedModuleMappings,
  TServiceDefinition,
  TServiceReturn,
  ZCCLibraryDefinition,
  ZZCApplicationDefinition as ZCCApplicationDefinition,
} from "../helpers/wiring.helper.mjs";
import { ILogger } from "./logger.extension.mjs";

const NONE = -1;
// ! This is a sorted array! Don't change the order
const LIFECYCLE_STAGES = [
  "PreInit",
  "PostConfig",
  "Bootstrap",
  "Ready",
  "ShutdownStart",
  "ShutdownComplete",
];
const FILE_CONTEXT = "boilerplate:Loader";

/**
 * This function MUST be run first. It defines methods used to register providers and other extensions found within this library
 *
 * It has the default assumption that the boilerplate library is extra super special, and has everything run explicitly first.
 * Boilerplate will automatically add it to the applications list, and it will do everything possible to maintain priority in running events.
 */
export function InitializeWiring() {
  /**
   * association of projects to { service : Declaration Function }
   */
  const MODULE_MAPPINGS = new Map<string, TModuleMappings>();
  /**
   * association of projects to { service : Initialized Service }
   */
  const LOADED_MODULES = new Map<string, TResolvedModuleMappings>();
  /**
   * Optimized reverse lookups: Declaration  Function => [project, service]
   */
  const REVERSE_MODULE_MAPPING = new Map<
    TServiceDefinition,
    [project: string, service: string]
  >();

  /**
   * HIGH PRIORITY LIFECYCLE EVENTS
   */
  const [
    onPreInit,
    onPostConfig,
    onBootstrap,
    onReady,
    onShutdownStart,
    onShutdownComplete,
  ] = LIFECYCLE_STAGES.map(
    stage =>
      (callback: LifecycleCallback, priority = NONE) => {
        if (completedLifecycleCallbacks.has(`on${stage}`)) {
          logger.fatal(`[on${stage}] late attach, cannot run callback`);
          wiring.FailFast();
          return;
        }
        parentCallbacks[stage].push([callback, priority]);
      },
  );

  /**
   * Details relating to the application that is actively running
   */
  let ACTIVE_APPLICATION: {
    application: ZCCApplicationDefinition;
  } = undefined;

  let completedLifecycleCallbacks = new Set<string>();
  // heisenberg's logger. it's probably here, but maybe not
  let logger: ILogger;

  const parentCallbacks = Object.fromEntries(
    LIFECYCLE_STAGES.map(i => [i, []]),
  );

  const processEvents = new Map([
    [
      "SIGTERM",
      async () => {
        await Teardown();
        await wiring.FailFast();
      },
    ],
    [
      "SIGINT",
      async () => {
        await Teardown();
        await wiring.FailFast();
      },
    ],
    // ["uncaughtException", () => {}],
    // ["unhandledRejection", (reason, promise) => {}],
  ]);

  //
  // Module Creation
  //
  function CreateLibrary({
    name: project,
    configuration,
    services = [],
  }: LibraryConfigurationOptions): ZCCLibraryDefinition {
    const library: ZCCLibraryDefinition = {
      configuration,
      getConfig: <T,>(property: string): T =>
        ZCC.config.get([project, property]),
      lifecycle: CreateChildLifecycle(),
      name: project,
      onError: callback => ZCC.event.on(ZCC_LIBRARY_ERROR(project), callback),
      services,
      wire: async () =>
        await eachSeries(services, async ([service, definition]) => {
          await WireService(project, service, definition);
        }),
    };
    return library;
  }

  function CreateApplication({
    // you should really define your own tho. using this is just lazy
    name = "zcc",
    services = [],
    libraries = [],
    configuration = {},
  }: ApplicationConfigurationOptions) {
    const out: ZCCApplicationDefinition = {
      configuration,
      getConfig: <T,>(property: string): T =>
        ZCC.config.get(["application", property]),
      libraries,
      name,
      services,
    };
    return out;
  }

  //
  // Wiring
  //
  async function WireService(
    project: string,
    service: string,
    definition: TServiceDefinition,
  ) {
    logger.trace(`Inserting %s#%s`, project, service);
    const mappings = MODULE_MAPPINGS.get(project) ?? {};
    if (!is.undefined(mappings[service])) {
      throw new BootstrapException(
        FILE_CONTEXT,
        "DUPLICATE_SERVICE_NAME",
        `${service} is already defined for ${project}`,
      );
    }
    mappings[service] = definition;
    MODULE_MAPPINGS.set(project, mappings);

    const context = `${project}:${service}`;
    try {
      logger.trace(`Initializing %s#%s`, project, service);
      const resolved = await definition({
        event: ZCC.event,
        getConfig: <T,>(
          property: string | [project: string, property: string],
        ): T =>
          ZCC.config.get(is.string(property) ? [project, property] : property),
        lifecycle: undefined,
        loader: ContextLoader(project),
        logger: ZCC.logger.context(`${project}:${service}`),
      });
      REVERSE_MODULE_MAPPING.set(definition, [project, service]);
      const loaded = LOADED_MODULES.get(project) ?? {};
      loaded[service] = resolved;
      LOADED_MODULES.set(service, loaded);
    } catch (error) {
      // Init errors at this level are considered blocking.
      // Doubling up on errors to be extra noisy for now, might back off to single later
      logger.fatal({ error, name: context }, `Initialization error`);
      // eslint-disable-next-line no-console
      console.log(error);
      setImmediate(() => wiring.FailFast());
    }
  }

  async function RunStageCallbacks(stage: string) {
    logger.trace(`Running %s callbacks`, stage.toLowerCase());
    completedLifecycleCallbacks.add(`on${stage}`);
    const sorted = parentCallbacks[stage].filter(([, sort]) => sort !== NONE);
    const quick = parentCallbacks[stage].filter(([, sort]) => sort === NONE);
    await eachSeries(
      sorted.sort(([, a], [, b]) => (a > b ? UP : DOWN)),
      async ([callback]) => await callback(),
    );
    await each(quick, async ([callback]) => await callback());
  }

  //
  // Lifecycle runners
  //
  async function Bootstrap(
    application: ZCCApplicationDefinition,
    options: BootstrapOptions,
  ) {
    if (ACTIVE_APPLICATION) {
      throw new BootstrapException(
        "wiring.extension",
        "NO_DUAL_BOOT",
        "Another application is already active, please terminate",
      );
    }
    try {
      ZCC.event = new EventEmitter();

      ACTIVE_APPLICATION = {
        application,
      };

      LIB_BOILERPLATE.wire();
      if (!is.empty(options.configuration)) {
        ZCC.config.merge(options.configuration);
      }
      logger = ZCC.logger.context(`boilerplate:wiring`);
      processEvents.forEach((callback, event) => process.on(event, callback));

      application.libraries ??= [];
      application.libraries.forEach(i => i.wire());

      await RunStageCallbacks("PreInit");
      await ZCC.config.loadConfig();
      await RunStageCallbacks("PostConfig");
      await RunStageCallbacks("Bootstrap");
      await RunStageCallbacks("Ready");
    } catch (error) {
      logger.fatal({ application, error }, "Bootstrap failed");
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  async function Teardown() {
    if (!ACTIVE_APPLICATION) {
      throw new InternalError(
        "bootstrap:wiring",
        "TEARDOWN_MISSING_APP",
        "Cannot teardown, there is no current application",
      );
    }
    ACTIVE_APPLICATION = undefined;
    completedLifecycleCallbacks = new Set<string>();
    LIFECYCLE_STAGES.forEach(stage => (parentCallbacks[stage] = []));
    processEvents.forEach((callback, event) =>
      process.removeListener(event, callback),
    );
    logger.info(`teardown complete`);
    logger = undefined;
  }

  //
  // Loaders
  //
  function ContextLoader(project: string) {
    return (service: string | TServiceDefinition): TServiceReturn => {
      if (!is.string(service)) {
        const pair = REVERSE_MODULE_MAPPING.get(service);
        service = pair.pop();
      }
      return LOADED_MODULES.get(project)[service];
    };
  }

  function GlobalLoader(service: string | TServiceDefinition): TServiceReturn {
    let project: string;
    if (!is.string(service)) {
      const pair = REVERSE_MODULE_MAPPING.get(service);
      service = pair.pop();
      project = pair.pop();
      return LOADED_MODULES.get(project)[service];
    }
    project = [...MODULE_MAPPINGS.keys()].find(key =>
      Object.keys(MODULE_MAPPINGS.get(key)).includes(service as string),
    );
    return project ? LOADED_MODULES.get(project)[service] : undefined;
  }

  //
  // Lifecycle
  //
  function CreateChildLifecycle() {
    const stages = [...LIFECYCLE_STAGES];
    const childCallbacks = Object.fromEntries(stages.map(i => [i, []]));

    const [
      onPreInit,
      onPostConfig,
      onBootstrap,
      onReady,
      onShutdownStart,
      onShutdownComplete,
    ] = LIFECYCLE_STAGES.map(
      stage =>
        (callback: LifecycleCallback, priority = NONE) => {
          if (completedLifecycleCallbacks.has(`on${stage}`)) {
            logger.fatal(`[on${stage}] late attach, cannot run callback`);
            wiring.FailFast();
            return;
          }
          childCallbacks[stage].push([callback, priority]);
        },
    );

    return {
      onBootstrap,
      onPostConfig,
      onPreInit,
      onReady,
      onShutdownComplete,
      onShutdownStart,
    };
  }

  //
  // Final Attachments!
  //
  ZCC.createApplication = CreateApplication;
  ZCC.createLibrary = CreateLibrary;
  ZCC.loader = GlobalLoader;
  ZCC.lifecycle = {
    child: CreateChildLifecycle,
    onBootstrap,
    onPostConfig,
    onPreInit,
    onReady,
    onShutdownComplete,
    onShutdownStart,
  };

  //
  // Do not return this object directly, adds complexity for unit testing & `FailFast`
  //
  const wiring = {
    Bootstrap,
    ContextLoader,
    CreateApplication: CreateApplication,
    FailFast: () => exit(),
    GlobalLoader,
    Lifecycle: { ...ZCC.lifecycle },
    Teardown,
  };

  //
  // Complete module
  //
  return wiring;
}

// Type definitions for global ZCC attachments
declare module "@zcc/utilities" {
  export interface ZCCDefinition {
    application: ApplicationDefinition | undefined;
    createApplication: (
      options: ApplicationConfigurationOptions,
    ) => ZCCApplicationDefinition;
    createLibrary: (
      options: LibraryConfigurationOptions,
    ) => ZCCLibraryDefinition;
    lifecycle: TParentLifecycle;
    loader: Loader;
  }
}
