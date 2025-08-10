"use client";

import { useEffect, useRef, useState } from "react";
import { notFound, useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft } from "lucide-react";
import * as vision from "@mediapipe/tasks-vision";

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const roomId = params.id;
  const [nameDraft, setNameDraft] = useState("");
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const poseRef = useRef<any>(null);
  const stageRef = useRef<"UP" | "DOWN">("UP");
  const sentCountRef = useRef(-1);
  const lastSentTsRef = useRef(0);
  const lastTsRef = useRef(0);

  useEffect(() => {
    if (!roomId) return notFound();
    setNameDraft("Player"); // default
  }, [roomId]);

  // Setup camera
  const setupCamera = async () => {
    console.log(videoRef.current);
    if (!videoRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    videoRef.current.srcObject = stream;
    await videoRef.current.play(); };

  // Setup Mediapipe Pose
  const setupPose = async () => {
    const { FilesetResolver, PoseLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm",
    );
    poseRef.current = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  };

  // Angle helper
  const angleDeg = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ) => {
    const baxx = ax - bx,
      baxy = ay - by;
    const bcx = cx - bx,
      bcy = cy - by;
    const nba = Math.hypot(baxx, baxy) || 1;
    const nbc = Math.hypot(bcx, bcy) || 1;
    const dot = (baxx / nba) * (bcx / nbc) + (baxy / nba) * (bcy / nbc);
    const clamped = Math.max(-1, Math.min(1, dot));
    return (Math.acos(clamped) * 180) / Math.PI;
  };

  // Send WS update
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
    if (wsRef.current)
      try {
        wsRef.current.close();
      } catch {}
    const wsScheme = location.protocol === "https:" ? "wss" : "ws";
    const uri = `${wsScheme}://${location.host}/ws/${room}?name=${encodeURIComponent(name)}`;
    wsRef.current = new WebSocket(uri);
    wsRef.current.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (["leaderboard", "join", "leave"].includes(data.type)) {
          setLeaderboard(Array.isArray(data.players) ? data.players : []);
        }
      } catch {}
    };
  };

  // Main loop
  const loop = async () => {
    if (
      !running ||
      !videoRef.current ||
      !canvasRef.current ||
      !poseRef.current
    ) {
      requestAnimationFrame(loop);
      return;
    }
    const ctx = canvasRef.current.getContext("2d");
    const vw = videoRef.current.videoWidth;
    const vh = videoRef.current.videoHeight;
    if (vw === 0 || vh === 0) return requestAnimationFrame(loop);

    if (canvasRef.current.width !== vw || canvasRef.current.height !== vh) {
      canvasRef.current.width = vw;
      canvasRef.current.height = vh;
    }

    const now = performance.now();
    const res = await poseRef.current.detectForVideo(videoRef.current, now);
    ctx?.drawImage(videoRef.current, 0, 0, vw, vh);

    if (res.landmarks && res.landmarks.length > 0) {
      const lms = res.landmarks[0];
      const s = lms[12],
        e = lms[14],
        w = lms[16];
      if (s && e && w) {
        const sx = s.x * vw,
          sy = s.y * vh;
        const ex = e.x * vw,
          ey = e.y * vh;
        const wx = w.x * vw,
          wy = w.y * vh;
        const ang = angleDeg(sx, sy, ex, ey, wx, wy);

        if (ang < 70 && stageRef.current === "UP") stageRef.current = "DOWN";
        else if (ang > 160 && stageRef.current === "DOWN") {
          stageRef.current = "UP";
          setCount((c) => c + 1);
          sendUpdateMaybe();
        }
      }
    }

    lastTsRef.current = now;
    requestAnimationFrame(loop);
  };

  // Start session
  const startSession = async () => {
    await setupCamera();
    await setupPose();
    connectWS(roomId, nameDraft);
    setRunning(true);
    requestAnimationFrame(loop);
  };

  return (
    <main className="min-h-[100dvh]">
      <header className="border-b">
        <div className="container mx-auto flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
            <ChevronLeft className="size-5" />
          </Button>
          <div className="font-semibold">Room {roomId}</div>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={startSession}>Connect & Start</Button>
          </div>
        </div>
      </header>

      <section className="container mx-auto grid gap-6 px-4 py-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Push-up Counter</CardTitle>
            </CardHeader>
            <CardContent>
              <video ref={videoRef} playsInline muted />
              <canvas ref={canvasRef} />
              <div className="mt-2 font-bold">Reps: {count}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
              {leaderboard.map((p, i) => (
                <div key={p.id} className="flex justify-between">
                  <span>
                    {i + 1}. {p.name}
                  </span>
                  <span>{p.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
