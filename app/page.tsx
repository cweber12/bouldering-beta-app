"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

type KP = [number, number];
type Pose = Record<string, KP>;

const POSES: Pose[] = [
  {
    no: [96, 20], ls: [80, 36], rs: [115, 36],
    le: [65, 52], re: [128, 28], lw: [55, 66], rw: [140, 18],
    lh: [86, 66], rh: [107, 66], lk: [83, 87], rk: [110, 87],
    la: [81, 107], ra: [112, 107],
  },
  {
    no: [102, 16], ls: [86, 30], rs: [118, 26],
    le: [76, 46], re: [130, 13], lw: [68, 60], rw: [143, 7],
    lh: [89, 63], rh: [111, 60], lk: [85, 84], rk: [115, 82],
    la: [81, 104], ra: [118, 102],
  },
  {
    no: [95, 36], ls: [82, 50], rs: [112, 50],
    le: [74, 66], re: [122, 63], lw: [65, 78], rw: [130, 73],
    lh: [87, 72], rh: [108, 72], lk: [84, 88], rk: [110, 88],
    la: [81, 99], ra: [112, 99],
  },
  {
    no: [94, 14], ls: [80, 28], rs: [112, 28],
    le: [66, 42], re: [124, 42], lw: [54, 50], rw: [136, 50],
    lh: [86, 60], rh: [107, 60], lk: [83, 80], rk: [108, 80],
    la: [80, 100], ra: [110, 100],
  },
];

const EDGES: [string, string][] = [
  ["no", "ls"], ["no", "rs"], ["ls", "rs"],
  ["ls", "le"], ["rs", "re"], ["le", "lw"], ["re", "rw"],
  ["ls", "lh"], ["rs", "rh"], ["lh", "rh"],
  ["lh", "lk"], ["rh", "rk"], ["lk", "la"], ["rk", "ra"],
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpPose(p1: Pose, p2: Pose, t: number): Pose {
  const out: Pose = {};
  for (const k of Object.keys(p1)) {
    out[k] = [lerp(p1[k][0], p2[k][0], t), lerp(p1[k][1], p2[k][1], t)];
  }
  return out;
}

const TOTAL_DEMO_FRAMES = 48;

function DemoPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let tick = 0;
    const id = setInterval(() => {
      tick = (tick + 1) % (TOTAL_DEMO_FRAMES * POSES.length);
      setFrame(tick % TOTAL_DEMO_FRAMES);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const poseFloat = (tick / TOTAL_DEMO_FRAMES) % POSES.length;
      const from = Math.floor(poseFloat) % POSES.length;
      const to = (from + 1) % POSES.length;
      const blend = poseFloat - Math.floor(poseFloat);
      const kp = lerpPose(POSES[from], POSES[to], blend);

      ctx.clearRect(0, 0, 192, 108);

      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,210,115,0.82)";
      ctx.lineCap = "round";
      for (const [a, b] of EDGES) {
        const pa = kp[a], pb = kp[b];
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(255,215,0,0.88)";
      for (const pt of Object.values(kp)) {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }, 80);

    return () => clearInterval(id);
  }, []);

  const pct = Math.round(((frame + 1) / TOTAL_DEMO_FRAMES) * 100);

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-edge bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-edge bg-inset px-3 py-1.5">
        <span className="text-xs font-mono text-fg-muted">route-photo.jpg</span>
        <span className="text-xs font-mono text-fg-muted">
          frame {frame + 1}/{TOTAL_DEMO_FRAMES}
        </span>
      </div>
      <div className="relative">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        />
        <canvas
          ref={canvasRef}
          width={192}
          height={108}
          className="w-full"
          aria-label="Demo skeleton overlay animation"
        />
      </div>
      <div className="flex items-center gap-2 border-t border-edge bg-inset px-3 py-1.5">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-edge">
          <div
            className="h-full rounded-full bg-success transition-all duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-8 text-right text-xs font-mono text-fg-muted">{pct}%</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  return (
    <main className="flex flex-1 flex-col items-center gap-16 px-6 py-16">
      <div className="flex flex-col items-center gap-4 text-center max-w-lg">
        <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-edge bg-card px-3 py-1 text-xs font-medium text-fg-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          All processing runs locally
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-fg">
          Route&nbsp;Renderer
        </h1>
        <p className="text-base text-fg-secondary leading-relaxed">
          Record your bouldering runs, extract skeleton poses with MoveNet, then
          project your movement onto a route photo &#8212; entirely in your browser.
        </p>
        {!loading && !user && (
          <Link
            href="/login"
            className="mt-2 flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover active:scale-95"
          >
            Sign in to get started
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        )}
        {!loading && user && (
          <Link
            href="/upload"
            className="mt-2 flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover active:scale-95"
          >
            Get started
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        )}
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-xs text-fg-muted uppercase tracking-wider">Live demo</p>
        <DemoPreview />
        <p className="text-xs text-fg-muted">
          Animated skeleton overlay &#8212; example of what Route Renderer produces
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <p className="mb-6 text-center text-xs text-fg-muted uppercase tracking-wider">
          How it works
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Upload your video",
              body: "MoveNet Lightning detects 17 body keypoints on every sampled frame. ORB descriptors are extracted from the first frame as a reference.",
            },
            {
              step: "2",
              title: "Match to route photo",
              body: "Upload a photo of the route. ORB features are matched and a RANSAC homography maps your skeleton coordinates onto the wall photo.",
            },
            {
              step: "3",
              title: "Export the overlay",
              body: "Download a WebM video of your skeleton overlaid on the route photo. Compare multiple runs side by side on the Compare page.",
            },
          ].map(({ step, title, body }) => (
            <div
              key={step}
              className="rounded-xl border border-edge bg-card px-5 py-5 flex flex-col gap-2"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-edge-hover text-xs font-bold text-fg-secondary">
                {step}
              </div>
              <p className="text-sm font-semibold text-fg">{title}</p>
              <p className="text-xs text-fg-secondary leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
