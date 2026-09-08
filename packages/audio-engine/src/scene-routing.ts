import type { RenderSceneV1 } from "@refrain/soundpack/vnext";

/** First-match routing is shared by execution and production inspection. */
export function sceneRouteForVoice(
  scene: RenderSceneV1,
  voice: { instrument: string; role: string },
) {
  return scene.routes.find(
    (route) =>
      (route.match.instrumentIds === undefined ||
        route.match.instrumentIds.includes(voice.instrument)) &&
      (route.match.roles === undefined ||
        route.match.roles.includes(voice.role)),
  );
}

/** Requires a validated acyclic scene, just as the executing adapters do. */
export function sceneBusChain(scene: RenderSceneV1, inputBus: string) {
  const chain: RenderSceneV1["buses"] = [];
  let next = inputBus;
  while (next !== "master") {
    const bus = scene.buses.find((candidate) => candidate.id === next)!;
    chain.push(bus);
    next = bus.output;
  }
  return chain;
}
