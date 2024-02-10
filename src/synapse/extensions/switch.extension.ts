import { TServiceParams } from "../../boilerplate";
import { TContext } from "../../utilities";

type TSwitch = {
  context: TContext;
  defaultState?: LocalOnOff;
  icon?: string;
  name: string;
};

type LocalOnOff = "on" | "off";

export type VirtualSwitch = {
  state: LocalOnOff;
  on: boolean;
  icon: string;
  id: string;
  name: string;
};

type UpdateSwitchBody = {
  event_type: "zcc_switch_update";
  data: { switch: string; state: LocalOnOff };
};

export function Switch({
  logger,
  context,
  lifecycle,
  hass,
  synapse,
}: TServiceParams) {
  const registry = synapse.registry<VirtualSwitch>({
    context,
    details: entity => ({
      state: entity.state,
    }),
    domain: "switch",
  });

  // ### Listen for socket events
  hass.socket.onEvent({
    context: context,
    event: "zcc_switch_update",
    exec({ data }: UpdateSwitchBody) {
      const item = registry.byId(data.switch);
      if (!item) {
        logger.warn({ data }, `Received switch update for unknown switch`);
        return;
      }
      const state = data.state;
      if (["on", "off"].includes(state)) {
        logger.warn({ state }, `received bad value for state update`);
        return;
      }
      if (item.state === state) {
        return;
      }
      logger.trace(
        { label: item.name, state: data.state },
        `received state update`,
      );
      item.state = state;
    },
  });

  /**
   * ### Register a new switch
   *
   * Can be interacted with via return object, or standard home assistant switch services
   */
  function create(entity: TSwitch) {
    let state: LocalOnOff;

    function setState(newState: LocalOnOff) {
      if (newState === state) {
        return;
      }
      state = newState;
      setImmediate(async () => {
        logger.trace({ id, state }, `switch state updated`);
        await registry.setCache(id, state);
        await registry.send(id, { state });
      });
    }

    lifecycle.onBootstrap(async () => {
      state = await registry.getCache(id, entity.defaultState ?? "off");
    });

    const returnEntity = new Proxy({} as VirtualSwitch, {
      get(_, property: keyof VirtualSwitch) {
        if (property === "state") {
          return state;
        }
        if (property === "on") {
          return state === "on";
        }
        if (property === "icon") {
          return entity.icon;
        }
        if (property === "name") {
          return entity.name;
        }
        return undefined;
      },
      set(_, property: keyof VirtualSwitch, value: LocalOnOff) {
        if (property === "state") {
          setImmediate(async () => await setState(value));
          return true;
        }
        if (property === "on") {
          setImmediate(async () => await setState(value ? "on" : "off"));
          return true;
        }
        return false;
      },
    });

    const id = registry.add(returnEntity);
    return returnEntity;
  }

  return create;
}