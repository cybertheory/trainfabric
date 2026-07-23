#!/usr/bin/env python3
import subprocess
import time

TID = "fa0d9cb2-b152-4873-ad95-96adc9f9f765"


def tail(n=30):
    return subprocess.check_output(
        ["clrun", "tail", TID, "--lines", str(n)], text=True, errors="replace"
    )


for i in range(90):
    o = tail(25)
    print(f"poll {i}", flush=True)
    if "Successfully tagged" in o or "naming to" in o or "ERROR" in o or "error:" in o.lower():
        # docker build finished-ish
        if "Successfully tagged" in o or ("exporting to image" in o and "DONE" in o):
            print(o[-2000:])
            break
        if "ERROR" in o or "error building" in o.lower():
            print(o[-2000:])
            break
    st = subprocess.check_output(["clrun", "status"], text=True, errors="replace")
    idx = st.find(TID)
    if idx >= 0 and "status: exited" in st[idx : idx + 400]:
        print("exited")
        print(o[-2500:])
        break
    time.sleep(10)
else:
    print(tail(40)[-2500:])
