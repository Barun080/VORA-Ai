"""ดาวน์โหลดโมเดลภาพ (MediaPipe) มาเก็บในเครื่อง เพื่อให้กล้องทำงานได้แม้ไม่มีอินเทอร์เน็ตตอนประกวด
รัน 1 ครั้งหลังติดตั้ง:  python scripts/download_models.py
"""
import sys
import urllib.request
from pathlib import Path

DEST = Path(__file__).resolve().parents[1] / "frontend" / "assets" / "models"
MODELS = {
    "blaze_face_short_range.tflite": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    "gesture_recognizer.task": "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
    "mobilenet_v3_small.tflite": "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite",
}


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    ok = True
    for name, url in MODELS.items():
        out = DEST / name
        if out.exists() and out.stat().st_size > 10_000:
            print(f"[มีแล้ว] {name}")
            continue
        try:
            print(f"[กำลังโหลด] {name} ...", end=" ", flush=True)
            urllib.request.urlretrieve(url, out)
            print(f"{out.stat().st_size / 1e6:.1f} MB")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"ไม่สำเร็จ: {e}")
    print("เสร็จสิ้น" if ok else "บางไฟล์โหลดไม่สำเร็จ ระบบจะโหลดจากอินเทอร์เน็ตแทนตอนใช้งาน")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
