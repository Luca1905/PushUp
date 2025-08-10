# client.py — AIGym detection + on-frame leaderboard
import argparse, asyncio, json, threading, time
from urllib.parse import quote

import cv2
from ultralytics import solutions
import websockets


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--room", required=True, help="Room code (e.g., ABCD)")
    ap.add_argument("--name", required=True, help="Your display name")
    ap.add_argument("--server", default="ws://localhost:8000", help="WebSocket server base URL")
    ap.add_argument("--camera", type=int, default=0, help="OpenCV camera index")
    ap.add_argument("--model", default="yolo11n-pose.pt", help="Ultralytics pose model")
    ap.add_argument("--record", action="store_true", help="Save annotated video to workouts_output.avi")
    # Push-up keypoints: right shoulder, elbow, wrist
    ap.add_argument("--kpts", nargs=3, type=int, default=[6, 8, 10], help="Keypoint indices for angle")
    return ap.parse_args()


async def ws_task(uri, shared):
    """
    shared = {
        "count": int,
        "leaderboard": list[{"id": str, "name": str, "count": int}],
        "running": bool
    }
    """
    async for ws in websockets.connect(uri, ping_interval=20, ping_timeout=20):
        try:
            last_sent = -1
            last_ping = time.time()
            # send initial count
            await ws.send(json.dumps({"type": "update", "count": int(shared["count"])}))

            while shared["running"]:
                # send count if changed
                if shared["count"] != last_sent:
                    await ws.send(json.dumps({"type": "update", "count": int(shared["count"])}))
                    last_sent = shared["count"]

                # periodic ping to keep "last_seen" fresh on server
                if time.time() - last_ping > 10:
                    try:
                        await ws.send(json.dumps({"type": "ping"}))
                    except:
                        pass
                    last_ping = time.time()

                # read any messages (join/leaderboard/leave) and update local leaderboard
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=0.1)
                    data = json.loads(msg)
                    if data.get("type") in ("leaderboard", "join", "leave"):
                        shared["leaderboard"] = data.get("players", [])
                except asyncio.TimeoutError:
                    pass

                await asyncio.sleep(0.03)
        except Exception:
            # quick retry on disconnect
            await asyncio.sleep(1.0)
        finally:
            if not shared["running"]:
                break


def draw_leaderboard(frame, my_count, leaderboard):
    """
    Draws a simple leaderboard box on the top-right + your local rep count on the top-left.
    """
    h, w = frame.shape[:2]
    pad = 12

    # Local count (top-left)
    cv2.rectangle(frame, (pad, pad), (pad + 220, pad + 88), (0, 0, 0), -1)
    cv2.putText(frame, f"Reps: {my_count}", (pad + 14, pad + 40),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2, cv2.LINE_AA)

    # Leaderboard (top-right)
    lbx, lby = w - 280, pad
    rows = min(10, len(leaderboard))
    box_h = 30 + 24 * rows
    cv2.rectangle(frame, (lbx, lby), (w - pad, lby + box_h), (0, 0, 0), -1)
    cv2.putText(frame, "Leaderboard", (lbx + 12, lby + 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)

    for i, p in enumerate(leaderboard[:rows], start=1):
        line = f"{i}. {p['name'][:14]:14}  {p['count']}"
        cv2.putText(frame, line, (lbx + 12, lby + 20 + 24 * i),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1, cv2.LINE_AA)


def main():
    args = parse_args()

    # WebSocket URL with room and name
    uri = f"{args.server}/ws/{args.room.upper()}?name={quote(args.name)}"

    shared = {"count": 0, "leaderboard": [], "running": True}
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_until_complete, args=(ws_task(uri, shared),), daemon=True).start()

    cap = cv2.VideoCapture(args.camera)
    assert cap.isOpened(), "Error reading camera"

    writer = None
    if args.record:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        writer = cv2.VideoWriter("workouts_output.avi", cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    # Your detection logic (AIGym) — set show=False so we can draw our own overlay
    gym = solutions.AIGym(
        show=False,
        kpts=args.kpts,          # [6,8,10] = R shoulder, elbow, wrist
        model=args.model,
    )

    try:
        last_time = time.time()
        fps_est = 0.0

        while cap.isOpened():
            ok, im0 = cap.read()
            if not ok:
                print("Video frame is empty or processing is complete.")
                break

            # Run your AIGym pipeline; get annotated frame
            results = gym(im0)  # or gym.process(im0) depending on your version
            frame = results.plot_im

            # Pull rep count from AIGym results
            counts = getattr(results, "workout_count", None)
            if counts is None:
                counts = getattr(results, "count", None)
            if isinstance(counts, (list, tuple)) and len(counts) > 0:
                shared["count"] = int(max(counts))
            elif isinstance(counts, (int, float)):
                shared["count"] = int(counts)

            # FPS
            now = time.time()
            dt = now - last_time
            if dt > 0:
                fps_est = 0.9 * fps_est + 0.1 * (1.0 / dt)
            last_time = now
            cv2.putText(frame, f"{fps_est:.1f} FPS", (10, frame.shape[0] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)

            # Draw leaderboard overlay
            draw_leaderboard(frame, shared["count"], shared["leaderboard"])

            # Show + (optional) record
            cv2.imshow("Push-up Client", frame)
            if writer is not None:
                writer.write(frame)

            if cv2.waitKey(1) & 0xFF in (27, ord('q')):
                break

    finally:
        shared["running"] = False
        cap.release()
        if writer is not None:
            writer.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
