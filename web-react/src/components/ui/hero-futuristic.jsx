import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useAspect, useTexture } from "@react-three/drei";
import { useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three/webgpu";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";

import {
  abs,
  blendScreen,
  float,
  mod,
  mx_cell_noise_float,
  oneMinus,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  pass,
  mix,
  add,
} from "three/tsl";

extend(THREE);

// scanline + bloom post-processing, driven by a WebGPU render graph
function PostProcessing({ strength = 1, threshold = 1, fullScreenEffect = true }) {
  const { gl, scene, camera } = useThree();
  const progressRef = useRef({ value: 0 });

  const render = useMemo(() => {
    const postProcessing = new THREE.PostProcessing(gl);
    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode("output");
    const bloomPass = bloom(scenePassColor, strength, 0.5, threshold);

    const uScanProgress = uniform(0);
    progressRef.current = uScanProgress;

    const scanPos = float(uScanProgress.value);
    const uvY = uv().y;
    const scanWidth = float(0.05);
    const scanLine = smoothstep(0, scanWidth, abs(uvY.sub(scanPos)));
    const cyanOverlay = vec3(0.16, 0.83, 1).mul(oneMinus(scanLine)).mul(0.4);

    const withScanEffect = mix(
      scenePassColor,
      add(scenePassColor, cyanOverlay),
      fullScreenEffect ? smoothstep(0.9, 1.0, oneMinus(scanLine)) : 1.0
    );

    const final = withScanEffect.add(bloomPass);
    postProcessing.outputNode = final;
    return postProcessing;
  }, [camera, gl, scene, strength, threshold, fullScreenEffect]);

  useFrame(({ clock }) => {
    progressRef.current.value = Math.sin(clock.getElapsedTime() * 0.5) * 0.5 + 0.5;
    render.render();
  }, 1);

  return null;
}

const WIDTH = 300;
const HEIGHT = 300;

function Scene({ textureSrc, depthSrc }) {
  const [rawMap, depthMap] = useTexture([textureSrc, depthSrc]);
  const meshRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (rawMap && depthMap) setVisible(true);
  }, [rawMap, depthMap]);

  const { material, uniforms } = useMemo(() => {
    const uPointer = uniform(new THREE.Vector2(0));
    const uProgress = uniform(0);
    const strength = 0.01;

    const tDepthMap = texture(depthMap);
    const tMap = texture(rawMap, uv().add(tDepthMap.r.mul(uPointer).mul(strength)));

    const aspect = float(WIDTH).div(HEIGHT);
    const tUv = vec2(uv().x.mul(aspect), uv().y);

    const tiling = vec2(120.0);
    const tiledUv = mod(tUv.mul(tiling), 2.0).sub(1.0);

    const brightness = mx_cell_noise_float(tUv.mul(tiling).div(2));

    const dist = float(tiledUv.length());
    const dot = float(smoothstep(0.5, 0.49, dist)).mul(brightness);

    const depth = tDepthMap;
    const flow = oneMinus(smoothstep(0, 0.02, abs(depth.sub(uProgress))));

    const mask = dot.mul(flow).mul(vec3(0.16, 0.83, 1).mul(10));
    const final = blendScreen(tMap, mask);

    const material = new THREE.MeshBasicNodeMaterial({
      colorNode: final,
      transparent: true,
      opacity: 0,
    });

    return { material, uniforms: { uPointer, uProgress } };
  }, [rawMap, depthMap]);

  const [w, h] = useAspect(WIDTH, HEIGHT);

  useFrame(() => {
    uniforms.uProgress.value = Math.sin(Date.now() * 0.0005) * 0.5 + 0.5;
    if (meshRef.current?.material && "opacity" in meshRef.current.material) {
      meshRef.current.material.opacity = THREE.MathUtils.lerp(
        meshRef.current.material.opacity,
        visible ? 1 : 0,
        0.07
      );
    }
  });

  useFrame(({ pointer }) => {
    uniforms.uPointer.value = pointer;
  });

  const scaleFactor = 0.85;
  return (
    <mesh ref={meshRef} scale={[w * scaleFactor, h * scaleFactor, 1]} material={material}>
      <planeGeometry />
    </mesh>
  );
}

// Probes for a *real* WebGPU backend. navigator.gpu can exist while the actual
// adapter/device negotiation still fails, in which case three.js silently falls
// back to a WebGL2 emulation layer that this node/TSL graph cannot render on —
// so we only trust a probe that got a genuine WebGPU backend, not just the flag.
async function probeWebGPU() {
  if (typeof navigator === "undefined" || !navigator.gpu) return false;
  try {
    const renderer = new THREE.WebGPURenderer({ antialias: false });
    await renderer.init();
    const isReal = renderer.backend?.isWebGPUBackend === true;
    renderer.dispose();
    return isReal;
  } catch {
    return false;
  }
}

export function HeroFuturistic({
  title = "SIRA WATCHES THE WIRE",
  subtitle = "An AI SOC copilot that shows its reasoning.",
  textureSrc,
  depthSrc,
  className = "",
}) {
  const titleWords = title.split(" ");
  const [visibleWords, setVisibleWords] = useState(0);
  const [subtitleVisible, setSubtitleVisible] = useState(false);
  const [supported, setSupported] = useState(null); // null = probing

  useEffect(() => {
    let cancelled = false;
    probeWebGPU().then((ok) => {
      if (!cancelled) setSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (visibleWords < titleWords.length) {
      const t = setTimeout(() => setVisibleWords(visibleWords + 1), 220);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setSubtitleVisible(true), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWords]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <div className="h-full uppercase items-center w-full absolute z-10 pointer-events-none px-10 flex justify-center flex-col">
        <div className="text-2xl md:text-4xl xl:text-5xl font-extrabold">
          <div className="flex flex-wrap justify-center gap-2 lg:gap-4 text-white">
            {titleWords.map((word, i) => (
              <span
                key={i}
                style={{
                  opacity: i < visibleWords ? 1 : 0,
                  transform: i < visibleWords ? "translateY(0)" : "translateY(8px)",
                  transition: "opacity .4s ease, transform .4s ease",
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>
        <div className="text-xs md:text-base xl:text-lg mt-3 text-center text-white/80 font-medium normal-case max-w-md">
          <div
            style={{
              opacity: subtitleVisible ? 1 : 0,
              transition: "opacity .5s ease",
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      {supported === true ? (
        <Canvas
          flat
          gl={async (props) => {
            const renderer = new THREE.WebGPURenderer(props);
            await renderer.init();
            return renderer;
          }}
        >
          <PostProcessing fullScreenEffect />
          <Scene textureSrc={textureSrc} depthSrc={depthSrc} />
        </Canvas>
      ) : (
        <div className="absolute inset-0 lp-webgpu-fallback" />
      )}
    </div>
  );
}

export default HeroFuturistic;
