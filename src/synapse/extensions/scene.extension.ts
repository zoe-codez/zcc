import { TBlackHole, TContext, TServiceParams, ZCC } from "../..";

type TScene = {
  exec: () => TBlackHole;
  context: TContext;
  icon?: string;
  name: string;
};

type HassSceneUpdateEvent = {
  event_type: "zcc_scene_activate";
  data: { scene: string };
};

export function Scene({ logger, hass, synapse, context }: TServiceParams) {
  const registry = synapse.registry<TScene>({
    context,
    domain: "scene",
  });

  // ### Listen for socket events
  hass.socket.onEvent({
    context: context,
    event: "zcc_scene_activate",
    exec({ data }: HassSceneUpdateEvent) {
      const item = registry.byId(data.scene);
      if (!item) {
        logger.warn({ data }, `Received button press for unknown scene`);
        return;
      }
      const { exec, name } = item;
      logger.trace({ data, label: name }, `received scene activation`);
      setImmediate(async () => {
        await ZCC.safeExec(async () => await exec());
      });
    },
  });

  /**
   * ### Register a new scene
   *
   * Basically the same thing as a button
   */
  function create(entity: TScene) {
    registry.add(entity);
  }
  return create;
}