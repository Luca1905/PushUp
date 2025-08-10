"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";
import { env } from "@/env";

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const roomId = params.id;
  const [nameDraft, setNameDraft] = useState("Player");
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Pose + WS variables
  const wsRef = useRef<WebSocket | null>(null);
  const poseRef = useRef<any>(null); // TFJS MoveNet detector
  const sentCountRef = useRef(-1);
  const lastSentTsRef = useRef(0);
  const lastTsRef = useRef(0);

  // PoseDetector + Pushup logic (ported from backend/web/index.html)
  class PoseDetector {
    results: any = null;
    findPose(ctx: CanvasRenderingContext2D, lms: any[], vw: number, vh: number, draw = true) {
      if (!draw) return;
      ctx.save();
      ctx.fillStyle = "#00d0ff";
      for (let i = 0; i < lms.length; i++) {
        const p: any = lms[i];
        if (!p || p.x == null || p.y == null) continue;
        ctx.beginPath();
        ctx.arc(p.x * vw, p.y * vh, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    findPosition(
      vw: number,
      vh: number,
      ctx: CanvasRenderingContext2D | null = null,
      draw = true,
      bboxWithHands = false,
    ) {
      const lmList: (any[] | null)[] = [];
      let bboxInfo: any = {};
      let extra_feature: any = null;
      const lms = (this.results?.landmarks?.[0] as any[]) || null;
      if (lms && lms.length) {
        for (let id = 0; id < lms.length; id++) {
          const lm: any = lms[id];
          if (!lm) {
            lmList.push(null);
            continue;
          }
          const cx = Math.round(lm.x * vw);
          const cy = Math.round(lm.y * vh);
          const cz = Math.round((lm.z || 0) * vw);
          lmList.push([id, cx, cy, cz]);
        }
        const hasL = lmList[11] && lmList[12];
        const ad = hasL ? (Math.abs((lmList[12] as any)[1] - (lmList[11] as any)[1]) >> 1) : 20;
        let x1: number | undefined, x2: number | undefined;
        if (hasL) {
          if (bboxWithHands && lmList[15] && lmList[16]) {
            x1 = (lmList[16] as any)[1] - ad;
            x2 = (lmList[15] as any)[1] + ad;
          } else {
            x1 = (lmList[12] as any)[1] - ad;
            x2 = (lmList[11] as any)[1] + ad;
          }
        } else if (lmList[23] && lmList[24]) {
          x1 = Math.min((lmList[23] as any)[1], (lmList[24] as any)[1]) - ad;
          x2 = Math.max((lmList[23] as any)[1], (lmList[24] as any)[1]) + ad;
        }

        const y2cand = [
          (lmList[29] as any)?.[2],
          (lmList[27] as any)?.[2],
          (lmList[28] as any)?.[2],
          (lmList[25] as any)?.[2],
          (lmList[26] as any)?.[2],
          (lmList[23] as any)?.[2],
          (lmList[24] as any)?.[2],
        ].filter((v) => typeof v === "number");
        const y2 = (y2cand.length ? Math.max(...y2cand) : vh - 1) + ad;

        const y1cand = [
          (lmList[1] as any)?.[2],
          (lmList[0] as any)?.[2],
          (lmList[11] as any)?.[2],
          (lmList[12] as any)?.[2],
        ].filter((v) => typeof v === "number");
        const y1 = (y1cand.length ? Math.min(...y1cand) : 0) - ad;

        if (typeof x1 === "number" && typeof x2 === "number") {
          const bbox = [x1, y1, x2 - x1, y2 - y1];
          const cx = bbox[0] + (bbox[2] >> 1);
          const cy = bbox[1] + (bbox[3] >> 1);
          bboxInfo = { bbox, center: [cx, cy] };
        }

        if (hasL) {
          const neck_x = Math.round(((lmList[12] as any)[1] + (lmList[11] as any)[1]) / 2);
          const neck_y = Math.round(((lmList[12] as any)[2] + (lmList[11] as any)[2]) / 2);
          extra_feature = [neck_x, neck_y];
        }

        if (draw && ctx) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,0,255,0.9)";
          ctx.lineWidth = 3;
          if (bboxInfo.bbox)
            ctx.strokeRect(bboxInfo.bbox[0], bboxInfo.bbox[1], bboxInfo.bbox[2], bboxInfo.bbox[3]);
          if (extra_feature) {
            ctx.fillStyle = "#0f0";
            ctx.beginPath();
            ctx.arc(extra_feature[0], extra_feature[1], 5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
      return { lmList, bboxInfo, extra_feature };
    }
  }

  class Pushup {
    count = 0;
    position: "Up" | "Down" | null = null;
    detect(lmList: (any[] | null)[]) {
      if (lmList && lmList.length) {
        const y = (i: number) => (lmList[i] as any)?.[2] ?? Infinity;
        // Up position
        if (y(12) > y(14) && y(11) > y(13) && y(12) > y(26) && y(24) > y(26) && y(23) > y(25)) {
          this.position = "Up";
        }
        // Down transition -> count++
        if (
          y(12) <= y(14) &&
          y(11) <= y(13) &&
          y(11) <= y(25) &&
          y(24) <= y(26) &&
          y(23) <= y(25) &&
          this.position === "Up"
        ) {
          this.position = "Down";
          this.count += 1;
        }
      }
      return this.count;
    }
  }

  const detector = useRef(new PoseDetector());
  const pushup = useRef(new Pushup());

  // Setup camera
  const setupCamera = async () => {
    if (!videoRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
  };

  // Build WS base from env or window, normalize http->ws and trim trailing slash
  const wsBase = () => {
    const fromEnv = (env as any).NEXT_PUBLIC_BACKEND_URL as string | undefined;
    const base =
      (fromEnv && fromEnv.trim()) ||
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    return base.replace(/^http(s?):\/\//, "ws$1://").replace(/\/+$/, "");
  };

  // Setup MoveNet (TFJS pose-detection) via CDN only (matches backend/web/index.html)
  const setupPose = async () => {
    try {
      const loadScript = (src: string) =>
        new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = src;
          s.async = true;
          s.onload = () => resolve();
          s.onerror = (e) => reject(e);
          document.head.appendChild(s);
        });

      // Load CDN scripts once
      const w = window as any;
      if (!w.tf) {
        await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/dist/tf.min.js");
      }
      if (!w.poseDetection) {
        await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection");
      }

      const tf = w.tf;
      const poseDetection = w.poseDetection;

      await tf.setBackend("webgl");
      await tf.ready();

      poseRef.current = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING },
      );
      // console.log("[MODEL] MoveNet loaded (CDN)");
    } catch (e) {
      console.error("[MODEL] failed to load via CDN", e);
    }
  };

  // Send WS update (same cadence logic)
  const sendUpdateMaybe = () => {
    const now = performance.now() / 1000;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (count !== sentCountRef.current || now - lastSentTsRef.current > 2.0) {
      wsRef.current.send(JSON.stringify({ type: "update", count: count | 0 }));
      sentCountRef.current = count;
      lastSentTsRef.current = now;
    }
  };

  // Connect WebSocket
  const connectWS = (room: string, name: string) => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
    }
    const uri = `${wsBase()}/ws/${room}?name=${encodeURIComponent(name)}`;
    wsRef.current = new WebSocket(uri);

    let pingId: any = null;
    wsRef.current.onopen = () => {
      sentCountRef.current = -1;
      lastSentTsRef.current = 0;
      pingId = setInterval(() => {
        try {
          wsRef.current?.readyState === WebSocket.OPEN &&
            wsRef.current?.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }, 10000);
    };
    wsRef.current.onclose = () => {
      if (pingId) clearInterval(pingId);
    };
    wsRef.current.onerror = (err) => {
      console.error("[WS] error", err);
    };
    wsRef.current.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (["leaderboard", "join", "leave"].includes(data.type)) {
          setLeaderboard(Array.isArray(data.players) ? data.players : []);
        }
      } catch (e) {
        console.warn("[WS] bad message", e);
      }
    };
  };

  // HUD (matches backend/web/index.html)
  const drawHUD = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(12, 12, 220, 88);
    ctx.fillStyle = "#fff";
    ctx.font = "20px system-ui, Arial";
    ctx.fillText(`Reps: ${count}`, 26, 50);

    const pad = 12,
      lbw = 270;
    const rows = Math.min(10, leaderboard.length);
    const boxH = 30 + 24 * rows;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(w - lbw - pad, pad, lbw, boxH);
    ctx.fillStyle = "#fff";
    ctx.font = "16px system-ui, Arial";
    ctx.fillText("Leaderboard", w - lbw - pad + 12, pad + 20);
    ctx.fillStyle = "rgb(220,220,220)";
    ctx.font = "14px system-ui, Arial";
    for (let i = 0; i < rows; i++) {
      const p = leaderboard[i];
      const nm = (p?.name || "").slice(0, 14).padEnd(14, " ");
      const line = `${i + 1}. ${nm}  ${p?.count ?? 0}`;
      ctx.fillText(line, w - lbw - pad + 12, pad + 20 + 24 * (i + 1));
    }
    ctx.restore();
  };

  // Main loop (matches flow from backend/web/index.html)
  const loop = async () => {
    if (!running || !videoRef.current || !canvasRef.current || !poseRef.current) {
      requestAnimationFrame(loop);
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return requestAnimationFrame(loop);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return requestAnimationFrame(loop);

    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }

    // Clear overlay (video is shown by <video>, not drawn into canvas)
    ctx.clearRect(0, 0, vw, vh);

    // Estimate poses with MoveNet
    const poses = await poseRef.current.estimatePoses(video);
    if (poses && poses.length > 0) {
      const kps: any[] = poses[0].keypoints || [];
      // Map MoveNet keypoints to 33-lms structure
      const nameToIdx: Record<string, number> = {
        nose: 0,
        left_eye: 1,
        right_eye: 2,
        left_ear: 3,
        right_ear: 4,
        left_shoulder: 11,
        right_shoulder: 12,
        left_elbow: 13,
        right_elbow: 14,
        left_wrist: 15,
        right_wrist: 16,
        left_hip: 23,
        right_hip: 24,
        left_knee: 25,
        right_knee: 26,
        left_ankle: 27,
        right_ankle: 28,
      };
      const lms: any[] = Array(33).fill(null);
      for (const kp of kps) {
        if (!kp || kp.score < 0.3) continue;
        const idx = nameToIdx[kp.name];
        if (idx != null) {
          lms[idx] = { x: kp.x / vw, y: kp.y / vh, z: 0 };
        }
      }
      // Fallback: use left_ankle for left_heel index 29 if available
      if (!lms[29] && lms[27]) lms[29] = lms[27];

      detector.current.results = { landmarks: [lms] };

      // Draw + count
      detector.current.findPose(ctx, lms, vw, vh, true);
      const { lmList } = detector.current.findPosition(vw, vh, ctx, true, false);
      const newCount = pushup.current.detect(lmList);
      if (newCount !== count) {
        setCount(newCount);
        sendUpdateMaybe();
      }
    }

    // FPS (bottom-left)
    const t = performance.now();
    const fps = lastTsRef.current ? 1000 / (t - lastTsRef.current) : 0;
    lastTsRef.current = t;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(10, vh - 34, 110, 24);
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, Arial";
    ctx.fillText(`${fps.toFixed(1)} FPS`, 16, vh - 16);

    // HUD
    drawHUD(ctx, vw, vh);

    requestAnimationFrame(loop);
  };

  // Start session
  const startSession = async () => {
    await setupCamera();
    await setupPose();
    connectWS(String(roomId).toUpperCase(), nameDraft || "Player");
    setRunning(true);
    requestAnimationFrame(loop);
  };

  useEffect(() => {
    if (!roomId || running) return;
    startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        setRunning(false);
        if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
          wsRef.current.close();
        }
        const tracks =
          (videoRef.current?.srcObject as MediaStream | null)?.getTracks?.() || [];
        tracks.forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  return (
    <main className="p-4">
      <Button variant="ghost" onClick={() => router.back()}>
        <ChevronLeft className="mr-2 h-4 w-4" /> Back
      </Button>
      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Room {String(roomId || "").toUpperCase()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Canvas overlays video like backend/web/index.html */}
          <div className="relative w-full max-w-[1100px] mx-auto">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="w-full h-auto rounded shadow"
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full rounded pointer-events-none"
            />
          </div>
          <div>Reps: {count}</div>
          <div className="text-sm text-muted-foreground">
            WS: {wsBase()}/ws/{String(roomId || "").toUpperCase()}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}