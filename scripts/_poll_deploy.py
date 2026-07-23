#!/usr/bin/env python3
import subprocess
import re
import time

TID = "129c1a3d-4ffc-4bab-b357-5cfaa03bb538"


def tail(n=8):
    return subprocess.check_output(
        ["clrun", "tail", TID, "--lines", str(n)], text=True, errors="replace"
    )


for i in range(120):
    o = tail(12)
    ms = re.findall(r"([0-9.]+)MB/([0-9.]+)MB", o)
    last = f"{ms[-1][0]}/{ms[-1][1]}MB" if ms else "-"
    done = any(
        x in o
        for x in (
            "Deployed",
            "Current Version ID",
            "Published",
            "Successfully",
            "Workers.dev",
        )
    )
    # detect failure
    low = o.lower()
    failed = ("error:" in low or "failed" in low) and "layer already" not in low
    print(f"poll {i}: last={last} done={done}", flush=True)
    if done or failed:
        print(o[-3500:])
        break
    # session ended?
    st = subprocess.check_output(["clrun", "status"], text=True, errors="replace")
    idx = st.find(TID)
    if idx >= 0 and ("status: exited" in st[idx : idx + 500] or "status: killed" in st[idx : idx + 500]):
        print("session ended")
        print(o[-3500:])
        break
    time.sleep(15)
else:
    print(tail(20)[-3000:])
