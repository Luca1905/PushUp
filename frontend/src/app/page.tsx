"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Users, Bolt, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { usePushupStore } from "@/hooks/use-pushup-store";
import { CreateRoomDialog } from "@/components/create-room-dialog";
import { JoinRoomDialog } from "@/components/join-room-dialog";

export default function Page() {
  const { rooms, you } = usePushupStore();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const activeCount = rooms.filter((r) => r.isActive).length;

  return (
    <main className="flex min-h-[100dvh] flex-col">
      <header className="border-b">
        <div className="container mx-auto flex items-center gap-3 px-4 py-4">
          <Bolt className="size-6 text-emerald-600" aria-hidden="true" />
          <Link href="/" className="text-lg font-bold">
            PushUp
          </Link>
          <Badge variant="secondary" className="ml-1">
            Mock
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={() => setJoinOpen(true)}>
              Join by code
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              Create room
            </Button>
          </div>
        </div>
      </header>

      <section className="container mx-auto grid gap-6 px-4 py-8">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_380px]">
          <div className="grid gap-4">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
              Do push-ups together, anywhere.
            </h1>
            <p className="text-muted-foreground max-w-[55ch]">
              Create a room, invite friends, and track your push-ups in real
              time. Start a quick session or compete on the leaderboard. No
              signup needed—this demo uses mock data.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 size-4" />
                Create a room
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setJoinOpen(true)}
              >
                Join by code
              </Button>
            </div>
            <div className="text-muted-foreground mt-2 flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Users className="size-4" aria-hidden="true" />
                <span>
                  {rooms.reduce((acc, r) => acc + r.participants.length, 0)}{" "}
                  participants
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Bolt className="size-4 text-emerald-600" aria-hidden="true" />
                <span>
                  {activeCount} active session{activeCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>

          <Card className="border-emerald-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy
                  className="size-5 text-emerald-600"
                  aria-hidden="true"
                />
                Leader tips
              </CardTitle>
              <CardDescription>
                How to run a better group session
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                • Set a clear goal (e.g., 100 total or AMRAP in 5 minutes)
              </div>
              <div>• Start the timer so everyone stays in sync</div>
              <div>• Cheer teammates and keep rest short</div>
              <div>• Keep the form clean—quality over quantity!</div>
            </CardContent>
            <CardFooter></CardFooter>
          </Card>
        </div>
      </section>

      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinRoomDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </main>
  );
}
