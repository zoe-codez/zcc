#!/usr/bin/env node
import { CreateApplication } from "..";
import { LIB_HASS } from "../hass";
import { IconGeneratorExtension } from "../synapse";
import { BuildTypes } from "./build.extension";
import { TypeWriter } from "./type-writer.extension";

export const TYPE_WRITER = CreateApplication({
  configuration: {
    TARGET_FILE: {
      description:
        "Define a file to write types to. Autodetect = default behavior",
      type: "string",
    },
  },
  libraries: [LIB_HASS],
  name: "type_writer",
  services: {
    build: BuildTypes,
    icons: IconGeneratorExtension,
    type_writer: TypeWriter,
  },
});
setImmediate(async () => {
  await TYPE_WRITER.bootstrap({
    configuration: {
      boilerplate: {
        LOG_LEVEL: "trace",
      },
      hass: {
        CALL_PROXY_AUTO_SCAN: false,
        SOCKET_AUTO_CONNECT: false,
      },
    },
  });
});

declare module "../boilerplate" {
  export interface LoadedModules {
    type_writer: typeof TYPE_WRITER;
  }
}
