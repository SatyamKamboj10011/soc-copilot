import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Renders the MetaPerson GLB avatar and animates it from a live Web Audio
 * AnalyserNode -- NOT a video, NOT Wav2Lip. This is real amplitude-driven
 * jaw movement using the model's actual ARKit blend shapes (confirmed
 * present: jawOpen on both AvatarHead and AvatarTeethLower), smoothly
 * interpolated frame to frame so it doesn't look twitchy.
 *
 * This is genuinely NOT phoneme-accurate lip-sync (it doesn't know which
 * sounds are being made, only how loud the audio is right now) -- but
 * blend-shape interpolation looks meaningfully smoother than the 2D
 * image-swap alternative discussed earlier, and it's real audio reactivity,
 * not a canned loop.
 *
 * Usage: <SiraAvatar3D analyserRef={analyserRef} speaking={speaking} />
 * analyserRef: a ref holding the same AnalyserNode already wired up
 *              elsewhere via ctx.createMediaElementSource(...).connect(analyser)
 * speaking: boolean -- when false, jaw eases back to closed and a slow
 *           idle blink loop runs instead of amplitude tracking.
 */
export default function SiraAvatar3D({ analyserRef, speaking, style }) {
  const mountRef = useRef(null);
  // The render loop below is created once (mount-time useEffect with empty
  // deps, since re-creating the whole Three.js scene on every speaking
  // change would be wasteful and wrong). That means a plain closure over
  // the `speaking` PROP would freeze at whatever it was at mount time --
  // this ref is what lets the loop see the current value every frame instead.
  const speakingRef = useRef(speaking);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);
  const rafRef = useRef(null);
  const jawTargetsRef = useRef([]); // [{mesh, index}] -- every mesh with a jawOpen morph target
  const blinkTargetsRef = useRef([]); // same shape, for eyeBlinkLeft/Right
  const currentJawRef = useRef(0);
  const nextBlinkAtRef = useRef(0);
  const blinkPhaseRef = useRef(0); // 0 = not blinking, else ms into blink

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 220;
    const height = mount.clientHeight || 220;

    const scene = new THREE.Scene();
    scene.background = null; // transparent -- shows through onto the app's dark panel behind it

    const camera = new THREE.PerspectiveCamera(28, width / height, 0.01, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // Simple three-point lighting -- enough to read a face clearly without
    // needing HDRI/environment setup for a small UI panel.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.5, 0.6, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8ec8ff, 0.6);
    fill.position.set(-1, 0.2, 0.6);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x29d3ff, 0.8);
    rim.position.set(0, 1, -1);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    let disposed = false;

    const loader = new GLTFLoader();
    loader.load(
      "/model.glb",
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;
        scene.add(root);

        // Collect every mesh that actually has a jawOpen / eyeBlink target --
        // AvatarHead and AvatarTeethLower both have jawOpen; only AvatarHead
        // has eyeBlinkLeft/Right. Iterating instead of hardcoding one mesh
        // means this keeps working even if MetaPerson's export changes
        // which meshes carry which targets.
        const jawTargets = [];
        const blinkTargets = [];
        let headMesh = null;

        root.traverse((obj) => {
          if (!obj.isMesh || !obj.morphTargetDictionary) return;
          const dict = obj.morphTargetDictionary;
          if ("jawOpen" in dict) jawTargets.push({ mesh: obj, index: dict["jawOpen"] });
          if ("eyeBlinkLeft" in dict && "eyeBlinkRight" in dict) {
            blinkTargets.push({
              mesh: obj,
              left: dict["eyeBlinkLeft"],
              right: dict["eyeBlinkRight"],
            });
          }
          if (obj.name === "AvatarHead") headMesh = obj;
        });

        jawTargetsRef.current = jawTargets;
        blinkTargetsRef.current = blinkTargets;

        // Frame the camera on the head specifically, not the whole
        // (standing, full-body) avatar -- compute the head mesh's own
        // world-space bounding box and centre the camera on it, rather
        // than hardcoding coordinates that would only work for this one
        // export's particular scale/proportions.
        const frameTarget = headMesh || root;
        const box = new THREE.Box3().setFromObject(frameTarget);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.y, size.z) * 0.9;

        camera.position.set(center.x, center.y + size.y * 0.08, center.z + radius * 2.4);
        camera.lookAt(center);
        camera.near = radius * 0.1;
        camera.far = radius * 20;
        camera.updateProjectionMatrix();
      },
      undefined,
      (err) => {
        console.error("[SiraAvatar3D] failed to load model.glb:", err);
      }
    );

    const clock = new THREE.Clock();
    const freqData = new Uint8Array(64);

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const dt = clock.getDelta();

      // ── Jaw: real amplitude from the live analyser while speaking ──
      let targetJaw = 0;
      if (speakingRef.current && analyserRef?.current) {
        analyserRef.current.getByteFrequencyData(freqData);
        const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length;
        // Compress to a natural-looking open range -- full 0-255 mapped
        // straight to 0-1 makes the jaw slam fully open on every loud
        // moment; capping around 0.65 reads as speech, not shouting.
        targetJaw = Math.min(0.65, avg / 190);
      }
      // Smooth toward the target instead of snapping -- avoids the jaw
      // jittering open/closed every single frame on noisy frequency data.
      currentJawRef.current += (targetJaw - currentJawRef.current) * Math.min(1, dt * 14);

      for (const { mesh, index } of jawTargetsRef.current) {
        if (mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences[index] = currentJawRef.current;
        }
      }

      // ── Idle blink loop -- small bit of life when not speaking too ──
      const now = clock.elapsedTime;
      if (nextBlinkAtRef.current === 0) nextBlinkAtRef.current = now + 2 + Math.random() * 3;
      let blinkValue = 0;
      if (blinkPhaseRef.current === 0 && now >= nextBlinkAtRef.current) {
        blinkPhaseRef.current = now; // start a blink
      }
      if (blinkPhaseRef.current !== 0) {
        const t = now - blinkPhaseRef.current;
        const BLINK_DURATION = 0.18;
        if (t < BLINK_DURATION) {
          // triangle envelope: close then open within BLINK_DURATION
          blinkValue = t < BLINK_DURATION / 2
            ? t / (BLINK_DURATION / 2)
            : 1 - (t - BLINK_DURATION / 2) / (BLINK_DURATION / 2);
        } else {
          blinkPhaseRef.current = 0;
          nextBlinkAtRef.current = now + 2 + Math.random() * 4;
        }
      }
      for (const { mesh, left, right } of blinkTargetsRef.current) {
        if (mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences[left] = blinkValue;
          mesh.morphTargetInfluences[right] = blinkValue;
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth || 220;
      const h = mount.clientHeight || 220;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // scene/loader set up once; speaking/analyserRef are read live via refs each frame

  return <div ref={mountRef} style={{ width: "100%", height: "100%", ...style }} />;
}