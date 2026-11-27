/**
 * VoraLiveRig & VoraCameraFaceTracker
 * Real-Time 2D Layered Character Animation Engine (Live2D-Style) + Closest-Face Webcam Eye Tracking
 * Source: Vora_(1).psd (31 active separated layers across hierarchical groups)
 *
 * Complete Idle Animation & Real-Time Face Tracking System (Mouth kept 100% static):
 * A. Natural Breathing (3–4s seamless loop):
 *    - 3.6s respiratory cycle on chest & shoulders with soft ribcage expansion
 *    - Grounded feet with subtle lower-body posture balance sway
 * B. Arm Movement & Secondary Motion:
 *    - Upper arms move in harmony with shoulder & ribcage breathing (zero stretching/warping)
 *    - Forearms & hands feature damped spring inertia and gentle asynchronous micro-shifts
 * C. Multi-Strand Hair Physics (Spring-Damper System):
 *    - Distinct spring-damper physics for Front Hair Bangs (H1, H2, H3), Side Hair Tails (L/R),
 *      and Back Hair (heavier inertia), driven by head velocity & tilt with safe clamping
 * D. Natural Eye Blinking (Random 3–6s interval, 150–250ms duration):
 *    - Uses original PSD eyelid, eyelash & eyebrow layers with per-column scanline deformation
 *    - Supports occasional natural double-blinks (~18% probability)
 * E. Subtle Eye Movement & F. Head Movement:
 *    - Conjugate eye gaze (zero strabismus/cross-eye) clipped strictly inside sclera bounds
 *    - Subtle micro-saccades, gentle glances, and smooth return to direct eye contact
 *    - Harmonic figure-8 head tilt & bob coupled with breathing and hair physics
 * 5. Real-Time Webcam Closest-Face Tracking:
 *    - Browser MediaDevices API (getUserMedia) with explicit user permission (never auto-opens without consent)
 *    - MediaPipe Face Landmarker / BlazeFace + Native & Built-in CV fallback
 *    - Selects closest face via largest bounding box area + two-stage smoothing filter
 *    - Smoothly returns to Default Eye Contact when face is lost or camera is off
 *    - Mouth ('mouth_smile' / 'Smile 1') remains 100% static at all times
 */

const HEAD_PAT_CONFIG = {
  defaultPose: 'POSE_NORMAL',
  poses: {
    POSE_NORMAL: {
      id: 'POSE_NORMAL',
      sourcePsd: 'VoraE1.psd',
      label: 'POSE_NORMAL (VoraE1 — ท่ายืนปกติ)',
      headPatEyeLayer: 'head_pat_eyelash', // PSD group 'head pat' > 'L eyelash'
      headPatMouthLayer: 'mouth_3',        // PSD group 'Mouth' > 'mouth 3'
      defaultMouthLayer: 'mouth_smile',    // PSD group 'Mouth' > 'Smile 1'
      eyeFallbackMode: false,
      dialogue: {
        enabled: false,
        lines: [
          'กำลังสนุกอยู่หรือเปล่าคะ?',
          'ต้องการแค่นี้เองหรอคะ?'
        ],
        fallbackLine: "I suppose... I don't mind.",
        displayDurationMs: 2600
      }
    },
    POSE_THINKING: {
      id: 'POSE_THINKING',
      sourcePsd: 'Vora.psd',
      label: 'POSE_THINKING (Vora — ท่าครุ่นคิด)',
      headPatEyeLayer: null,               // Uses fallback eyelid squeeze to 100%
      headPatMouthLayer: null,             // Keeps default 'Smile 1'
      defaultMouthLayer: 'mouth_smile',
      eyeFallbackMode: true,
      dialogue: {
        enabled: true,
        lines: [
          'กำลังสนุกอยู่หรือเปล่าคะ?',
          'ต้องการแค่นี้เองหรอคะ?'
        ],
        fallbackLine: "I suppose... I don't mind.",
        displayDurationMs: 2600
      }
    }
  },
  timing: {
    startDurationMs: 400,         // 0.3–0.5s: HEAD_PAT_START -> HEAD_PAT_ACTIVE
    longThresholdMs: 3000,        // 3.0s real time: HEAD_PAT_ACTIVE -> HEAD_PAT_LONG
    mouthCrossfadeMs: 160,        // 120–200ms cross-fade between Smile 1 and mouth 3
    eyeCrossfadeMs: 200,          // 150–250ms cross-fade between Eyesemote 1 and head pat
    gazePauseBlendMs: 200,        // ~200ms smooth webcam eye tracking pause/resume
    maxBlinkFinishMs: 150,        // <= 150ms let active blink finish before head pat takes over
    poseTransitionMs: 420,        // Smooth cross-fade duration when switching poses
    randomPoseMinIntervalMs: 8000,
    randomPoseMaxIntervalMs: 20000,
    randomThinkingHoldMinMs: 2000,
    randomThinkingHoldMaxMs: 4000,
    randomThinkingHoldMs: 3000
  },
  motion: {
    maxTiltDeg: 4.0,              // Default max head tilt ±4°
    hardMaxTiltDeg: 5.0,          // Strictly never exceed ±5°
    maxShiftRatio: 0.015,         // 1.5% of head width (~7.5px in rig space, hard max 2%)
    hardMaxShiftRatio: 0.020,     // 2.0% hard cap
    longDipRatio: 0.010,          // ~1% of head height (~5.0px downward dip in HEAD_PAT_LONG)
    bodyFollowRatio: 0.28,        // Shoulders/upper body follow 1/4 to 1/3 (0.28) of head movement
    hairTailFollowRatio: 0.72,    // Side hair tails (L tail, R tail) lag & follow more
    hairBangFollowRatio: 0.34,    // Front hair bangs (H1, H2, H3) follow subtly
    maxHairTailOffsetDeg: 3.2,
    maxHairBangOffsetDeg: 1.5,
    tiltDampingSpeed: 8.8,
    releaseDampingSpeed: 6.8
  },
  eyelidSqueeze: {
    startTarget: 0.35,            // ~35% squeeze within first 0.4s (HEAD_PAT_START)
    activeTargetNormal: 0.65,     // 60–70% squeeze by 3.0s in POSE_NORMAL before cross-fade
    activeTargetFallback: 1.00    // 100% closed at 3.0s in POSE_THINKING fallback mode
  },
  hitbox: {
    psdBounds: { left: 1332, top: 842, right: 2327, bottom: 1834 },
    psdNeckPivot: { x: 1820, y: 1900 }
  }
};

if (typeof window !== 'undefined') {
  window.HEAD_PAT_CONFIG = HEAD_PAT_CONFIG;
}

const VORA_RIG_MANIFEST = {
  "character": "Vora",
  "sourcePsd": "VoraE1.psd + Vora.psd",
  "psdCanvas": {
    "width": 3600,
    "height": 5000
  },
  "cropOrigin": {
    "x": 1090,
    "y": 780,
    "width": 1420,
    "height": 3300
  },
  "scale": 0.5,
  "canvas": {
    "width": 710,
    "height": 1650
  },
  "pivots": {
    "pelvis": [
      347.5,
      950.0
    ],
    "chest": [
      347.5,
      935.0
    ],
    "neck": [
      365.0,
      560.0
    ],
    "head": [
      365.0,
      560.0
    ],
    "chinArm": [
      172.5,
      765.0
    ],
    "crown": [
      362.5,
      90.0
    ],
    "tailL": [
      215.0,
      140.0
    ],
    "tailR": [
      505.0,
      140.0
    ],
    "backHair": [
      362.5,
      320.0
    ],
    "legL": [
      262.0,
      1020.0
    ],
    "legR": [
      427.5,
      1030.0
    ],
    "feetL": [
      262.0,
      1600.0
    ],
    "feetR": [
      427.5,
      1605.0
    ]
  },
  "parts": {
    "back_hair": {
      "index": 2,
      "key": "back_hair",
      "originalName": "B H Copy",
      "file": "assets/vora/back_hair.png?v=2",
      "x": 26.0,
      "y": 234.0,
      "w": 651,
      "h": 806,
      "psdRect": [1142, 1248, 2444, 2861]
    },
    "hip": {
      "index": 3,
      "key": "hip",
      "originalName": "Hip",
      "file": "assets/vora_e1/hip.png?v=1",
      "x": 180.5,
      "y": 919.5,
      "w": 329,
      "h": 172,
      "psdRect": [1451, 2619, 2109, 2963]
    },
    "leg_l": {
      "index": 302,
      "key": "leg_l",
      "originalName": "L Leg",
      "file": "assets/vora_e1/leg_l.png?v=1",
      "x": 170.0,
      "y": 980.5,
      "w": 184,
      "h": 632,
      "psdRect": [1430, 2741, 1798, 4005]
    },
    "leg_r": {
      "index": 303,
      "key": "leg_r",
      "originalName": "R leg",
      "file": "assets/vora_e1/leg_r.png?v=1",
      "x": 333.0,
      "y": 991.0,
      "w": 189,
      "h": 623,
      "psdRect": [1756, 2762, 2134, 4008]
    },
    "lower_body": {
      "index": 304,
      "key": "lower_body",
      "originalName": "Lower nody Copy",
      "file": "assets/vora/lower_body.png?v=2",
      "x": 170.0,
      "y": 919.5,
      "w": 352,
      "h": 694,
      "psdRect": [1430, 2619, 2134, 4008]
    },
    "upper_body": {
      "index": 4,
      "key": "upper_body",
      "originalName": "Body Copy",
      "file": "assets/vora/upper_body.png?v=2",
      "x": 158.0,
      "y": 534.0,
      "w": 386,
      "h": 478,
      "psdRect": [1406, 1848, 2177, 2805]
    },
    "l_upper_arm": {
      "index": 5,
      "key": "l_upper_arm",
      "originalName": "L F arm Copy",
      "file": "assets/vora/l_upper_arm.png?v=2",
      "x": 151.5,
      "y": 578.5,
      "w": 103,
      "h": 209,
      "psdRect": [1393, 1937, 1599, 2355]
    },
    "r_forearm": {
      "index": 6,
      "key": "r_forearm",
      "originalName": "R fo arm Copy",
      "file": "assets/vora/r_forearm.png?v=2",
      "x": 148.0,
      "y": 708.0,
      "w": 360,
      "h": 124,
      "psdRect": [1386, 2196, 2107, 2445]
    },
    "r_upper_arm": {
      "index": 7,
      "key": "r_upper_arm",
      "originalName": "R F arm Copy",
      "file": "assets/vora/r_upper_arm.png?v=2",
      "x": 472.0,
      "y": 574.5,
      "w": 104,
      "h": 259,
      "psdRect": [2034, 1929, 2242, 2447]
    },
    "neck": {
      "index": 8,
      "key": "neck",
      "originalName": "Neck Copy",
      "file": "assets/vora/neck.png?v=2",
      "x": 317.0,
      "y": 512.5,
      "w": 96,
      "h": 98,
      "psdRect": [1724, 1805, 1917, 2001]
    },
    "middle_hair": {
      "index": 9,
      "key": "middle_hair",
      "originalName": "Middle hair Copy",
      "file": "assets/vora/middle_hair.png?v=2",
      "x": 121.0,
      "y": 31.0,
      "w": 498,
      "h": 424,
      "psdRect": [1332, 842, 2327, 1690]
    },
    "head": {
      "index": 10,
      "key": "head",
      "originalName": "Head Copy",
      "file": "assets/vora/head.png?v=2",
      "x": 153.0,
      "y": 230.0,
      "w": 424,
      "h": 297,
      "psdRect": [1396, 1240, 2245, 1834]
    },
    "l_forearm_chin": {
      "index": 11,
      "key": "l_forearm_chin",
      "originalName": "Fo arm Copy",
      "file": "assets/vora/l_forearm_chin.png?v=2",
      "x": 149.5,
      "y": 504.0,
      "w": 220,
      "h": 297,
      "psdRect": [1389, 1788, 1828, 2382]
    },
    "hair_tail_l": {
      "index": 14,
      "key": "hair_tail_l",
      "originalName": "L tail Copy",
      "file": "assets/vora/hair_tail_l.png?v=2",
      "x": 139.0,
      "y": 88.0,
      "w": 160,
      "h": 420,
      "psdRect": [1368, 956, 1689, 1797]
    },
    "hair_tail_r": {
      "index": 15,
      "key": "hair_tail_r",
      "originalName": "R tail Copy",
      "file": "assets/vora/hair_tail_r.png?v=2",
      "x": 429.0,
      "y": 89.5,
      "w": 160,
      "h": 416,
      "psdRect": [1948, 959, 2269, 1791]
    },
    "bang_r": {
      "index": 18,
      "key": "bang_r",
      "originalName": "H3",
      "file": "assets/vora/bang_r.png?v=2",
      "x": 378.5,
      "y": 83.0,
      "w": 152,
      "h": 268,
      "psdRect": [1847, 946, 2150, 1482]
    },
    "bang_l": {
      "index": 19,
      "key": "bang_l",
      "originalName": "H2",
      "file": "assets/vora/bang_l.png?v=2",
      "x": 193.5,
      "y": 83.0,
      "w": 282,
      "h": 277,
      "psdRect": [1477, 946, 2041, 1500]
    },
    "bang_c": {
      "index": 20,
      "key": "bang_c",
      "originalName": "H1",
      "file": "assets/vora/bang_c.png?v=2",
      "x": 280.0,
      "y": 82.5,
      "w": 153,
      "h": 286,
      "psdRect": [1650, 945, 1956, 1516]
    },
    "headband": {
      "index": 23,
      "key": "headband",
      "originalName": "Headband",
      "file": "assets/vora/headband.png?v=2",
      "x": 123.5,
      "y": 66.5,
      "w": 492,
      "h": 220,
      "psdRect": [1337, 913, 2321, 1354]
    },
    "eye_l_sclera": {
      "index": 27,
      "key": "eye_l_sclera",
      "originalName": "Layer 31 Copy",
      "file": "assets/vora/eye_l_sclera.png?v=2",
      "x": 394.5,
      "y": 336.5,
      "w": 118,
      "h": 52,
      "psdRect": [1879, 1453, 2116, 1556]
    },
    "eye_l_lower": {
      "index": 28,
      "key": "eye_l_lower",
      "originalName": "Lower Copy",
      "file": "assets/vora/eye_l_lower.png?v=2",
      "x": 416.0,
      "y": 362.5,
      "w": 91,
      "h": 26,
      "psdRect": [1922, 1505, 2104, 1556]
    },
    "eye_l_iris": {
      "index": 29,
      "key": "eye_l_iris",
      "originalName": "Eyeball",
      "file": "assets/vora/eye_l_iris.png?v=2",
      "x": 419.5,
      "y": 335.0,
      "w": 58,
      "h": 46,
      "psdRect": [1929, 1450, 2044, 1541]
    },
    "eye_l_sup": {
      "index": 30,
      "key": "eye_l_sup",
      "originalName": "Supeyelash Copy",
      "file": "assets/vora/eye_l_sup.png?v=2",
      "x": 504.5,
      "y": 342.5,
      "w": 15,
      "h": 18,
      "psdRect": [2099, 1465, 2129, 1502]
    },
    "eye_l_upper": {
      "index": 31,
      "key": "eye_l_upper",
      "originalName": "Layer 11 Copy",
      "file": "assets/vora/eye_l_upper.png?v=2",
      "x": 392.0,
      "y": 330.0,
      "w": 145,
      "h": 38,
      "psdRect": [1874, 1440, 2164, 1517],
      "dyProfile": [18.0,18.18,18.4,18.65,18.9,19.17,19.45,19.74,20.04,20.34,20.65,20.96,21.28,21.6,21.92,22.25,22.58,22.91,23.25,23.58,23.92,24.25,24.59,24.92,25.26,25.59,25.92,26.26,26.58,26.91,27.24,27.56,27.88,28.19,28.5,28.81,29.12,29.42,29.71,30.0,30.29,30.57,30.84,31.11,31.38,31.63,31.88,32.13,32.37,32.6,32.83,33.04,33.25,33.46,33.66,33.84,34.03,34.2,34.37,34.53,34.68,34.82,34.96,35.08,35.2,35.31,35.42,35.51,35.6,35.68,35.75,35.81,35.87,35.91,35.95,35.98,36.01,36.03,36.03,36.04,36.03,36.02,36.0,35.97,35.93,35.89,35.85,35.79,35.73,35.66,35.59,35.51,35.43,35.34,35.25,35.15,35.05,34.94,34.83,34.71,34.59,34.47,34.34,34.22,34.08,33.95,33.81,33.68,33.54,33.4,33.26,33.12,32.97,32.83,32.69,32.55,32.41,32.28,32.14,32.01,31.88,31.76,31.64,31.52,31.41,31.31,31.21,31.12,31.04,30.97,30.92,30.88,30.87,30.93,31.03,31.12,31.22,31.32,31.42,31.51,31.61,31.71,31.81,31.9,32.0],
      "yCenterProfile": [38.0,36.5,35.49,33.99,32.74,31.98,30.98,29.99,29.47,28.7,27.98,26.98,26.25,25.7,24.98,24.45,23.75,23.19,22.47,21.93,21.25,20.68,20.42,19.5,19.21,18.66,18.16,17.3,16.95,16.6,15.95,15.64,15.19,14.69,14.44,14.19,13.69,13.37,13.0,12.68,12.25,11.93,11.68,11.35,11.17,10.58,10.5,10.08,9.92,9.83,9.5,9.09,9.0,8.91,8.5,8.25,8.15,8.0,7.8,7.8,7.5,7.29,7.0,7.0,7.0,6.86,6.86,6.75,6.63,6.75,6.51,6.75,6.62,6.5,6.75,6.37,6.5,6.5,6.75,6.61,6.5,6.61,6.75,6.75,6.5,6.6,6.6,6.65,6.6,6.75,6.84,6.75,6.75,6.91,6.91,6.75,6.75,6.83,7.17,7.0,7.25,7.25,7.5,7.32,7.43,7.75,7.5,7.69,7.75,7.75,7.81,7.75,7.75,8.0,7.95,7.95,7.75,8.0,8.2,8.25,8.04,8.04,8.25,8.46,8.25,8.25,8.47,8.5,8.5,7.58,7.27,7.0,6.25,5.54,5.02,4.52,4.01,3.51,3.01,3.0,2.26,1.51,1.5,1.0,0.75]
    },
    "eye_l_crease": {
      "index": 32,
      "key": "eye_l_crease",
      "originalName": "Layer 48 Copy",
      "file": "assets/vora/eye_l_crease.png?v=2",
      "x": 398.5,
      "y": 327.5,
      "w": 86,
      "h": 30,
      "psdRect": [1887, 1435, 2058, 1494]
    },
    "eye_r_brow": {
      "index": 33,
      "key": "eye_r_brow",
      "originalName": "Eye blow",
      "file": "assets/vora/eye_r_brow.png?v=2",
      "x": 212.0,
      "y": 298.0,
      "w": 96,
      "h": 14,
      "psdRect": [1514, 1376, 1705, 1404]
    },
    "eye_r_sclera": {
      "index": 36,
      "key": "eye_r_sclera",
      "originalName": "white eye Copy",
      "file": "assets/vora/eye_r_sclera.png?v=2",
      "x": 196.5,
      "y": 339.0,
      "w": 118,
      "h": 50,
      "psdRect": [1483, 1458, 1718, 1558]
    },
    "eye_r_lower": {
      "index": 37,
      "key": "eye_r_lower",
      "originalName": "Lower eyelash Copy",
      "file": "assets/vora/eye_r_lower.png?v=2",
      "x": 203.0,
      "y": 364.5,
      "w": 92,
      "h": 24,
      "psdRect": [1496, 1509, 1681, 1557]
    },
    "eye_r_iris": {
      "index": 38,
      "key": "eye_r_iris",
      "originalName": "Eyeball Copy",
      "file": "assets/vora/eye_r_iris.png?v=2",
      "x": 242.5,
      "y": 337.5,
      "w": 56,
      "h": 44,
      "psdRect": [1575, 1455, 1687, 1542]
    },
    "eye_r_sup": {
      "index": 39,
      "key": "eye_r_sup",
      "originalName": "supeyelash Copy",
      "file": "assets/vora/eye_r_sup.png?v=2",
      "x": 191.5,
      "y": 343.0,
      "w": 13,
      "h": 18,
      "psdRect": [1473, 1466, 1499, 1503]
    },
    "eye_r_upper": {
      "index": 40,
      "key": "eye_r_upper",
      "originalName": "eyelash Copy",
      "file": "assets/vora/eye_r_upper.png?v=2",
      "x": 176.5,
      "y": 330.5,
      "w": 142,
      "h": 40,
      "psdRect": [1443, 1441, 1726, 1521],
      "dyProfile": [32.0,31.9,31.8,31.7,31.6,31.5,31.4,31.3,31.21,31.11,31.01,30.91,30.87,30.89,30.93,30.99,31.07,31.15,31.25,31.35,31.46,31.57,31.69,31.82,31.95,32.08,32.22,32.36,32.5,32.64,32.78,32.93,33.07,33.22,33.36,33.5,33.64,33.79,33.92,34.06,34.2,34.33,34.46,34.58,34.71,34.82,34.94,35.05,35.15,35.25,35.35,35.44,35.52,35.6,35.68,35.74,35.8,35.86,35.9,35.94,35.98,36.0,36.02,36.03,36.04,36.03,36.02,36.0,35.97,35.94,35.89,35.84,35.78,35.71,35.63,35.55,35.45,35.35,35.24,35.12,34.99,34.86,34.71,34.56,34.4,34.23,34.06,33.87,33.68,33.48,33.27,33.06,32.83,32.61,32.37,32.12,31.87,31.62,31.35,31.08,30.81,30.53,30.24,29.95,29.65,29.35,29.04,28.73,28.41,28.09,27.77,27.44,27.11,26.78,26.44,26.11,25.77,25.43,25.09,24.74,24.4,24.06,23.72,23.37,23.03,22.69,22.36,22.02,21.69,21.36,21.03,20.71,20.4,20.09,19.78,19.49,19.2,18.93,18.66,18.41,18.19,18.0],
      "yCenterProfile": [0.5,0.5,1.0,1.5,2.5,3.0,3.75,4.0,4.75,5.25,5.75,6.5,7.25,8.25,9.0,9.5,9.5,9.5,9.5,9.25,9.25,9.0,9.25,9.25,9.25,9.25,9.0,9.0,9.0,9.0,9.0,8.75,8.75,8.75,8.75,8.75,8.75,8.75,8.75,8.75,8.75,8.75,8.75,8.75,9.25,9.0,9.0,9.0,9.0,9.0,9.25,9.25,9.25,9.25,9.25,9.5,9.25,9.25,9.0,9.0,9.0,9.25,9.25,9.0,9.0,9.0,9.25,9.0,9.0,8.75,9.25,9.0,9.0,9.25,9.25,9.25,9.25,9.25,9.25,9.5,9.5,9.5,9.5,10.0,10.0,10.0,10.5,10.5,10.5,11.0,11.25,11.25,11.25,11.75,12.0,12.5,12.5,12.75,13.0,13.25,13.5,13.75,14.25,14.5,15.0,15.0,15.5,16.0,16.5,16.75,17.25,17.75,18.0,18.75,19.0,19.25,20.25,20.75,21.0,21.5,21.75,22.75,23.0,23.75,24.25,25.25,25.5,26.5,26.75,27.75,28.25,29.25,30.0,30.75,31.25,32.25,33.25,34.25,35.25,36.5,38.0,38.75]
    },
    "eye_r_crease": {
      "index": 41,
      "key": "eye_r_crease",
      "originalName": "eyelayer Copy",
      "file": "assets/vora/eye_r_crease.png?v=2",
      "x": 230.5,
      "y": 330.0,
      "w": 86,
      "h": 31,
      "psdRect": [1551, 1440, 1724, 1502]
    },
    "eye_l_brow": {
      "index": 42,
      "key": "eye_l_brow",
      "originalName": "eyeblow",
      "file": "assets/vora/eye_l_brow.png?v=2",
      "x": 400.5,
      "y": 293.0,
      "w": 102,
      "h": 20,
      "psdRect": [1891, 1366, 2094, 1406]
    },
    "mouth_smile": {
      "index": 46,
      "key": "mouth_smile",
      "originalName": "Smile 1",
      "file": "assets/vora/mouth_smile.png?v=2",
      "x": 338.5,
      "y": 462.5,
      "w": 53,
      "h": 9,
      "psdRect": [1767, 1705, 1873, 1723]
    },
    "mouth_2": {
      "index": 84,
      "key": "mouth_2",
      "originalName": "mouth 2",
      "file": "assets/vora_e1/mouth_2.png?v=2",
      "x": 345.0,
      "y": 467.0,
      "w": 38,
      "h": 23,
      "psdRect": [1780, 1714, 1856, 1760]
    },
    "mouth_3": {
      "index": 83,
      "key": "mouth_3",
      "originalName": "mouth 3",
      "file": "assets/vora_e1/mouth_3.png?v=1",
      "x": 348.5,
      "y": 459.0,
      "w": 15,
      "h": 47,
      "psdRect": [1787, 1698, 1817, 1792]
    },
    "head_pat_eyelash": {
      "index": 78,
      "key": "head_pat_eyelash",
      "originalName": "L eyelash",
      "file": "assets/vora_e1/head_pat_eyelash.png?v=1",
      "x": 219.0,
      "y": 358.5,
      "w": 286,
      "h": 32,
      "psdRect": [1528, 1497, 2101, 1562]
    },
    "viewer_l_upper_arm_skin": {
      "index": 23,
      "key": "viewer_l_upper_arm_skin",
      "originalName": "R　upper　arm",
      "file": "assets/vora_e1/viewer_l_upper_arm_skin.png?v=1",
      "x": 154.0,
      "y": 695.0,
      "w": 80,
      "h": 100,
      "psdRect": [1398, 2170, 1559, 2369]
    },
    "viewer_r_upper_arm_skin": {
      "index": 22,
      "key": "viewer_r_upper_arm_skin",
      "originalName": "L　Upper  arm",
      "file": "assets/vora_e1/viewer_r_upper_arm_skin.png?v=1",
      "x": 469.5,
      "y": 721.5,
      "w": 84,
      "h": 80,
      "psdRect": [2029, 2223, 2197, 2384]
    },
    "l_sleeve": {
      "index": 29,
      "key": "l_sleeve",
      "originalName": "L sleeve",
      "file": "assets/vora_e1/l_sleeve.png?v=2",
      "x": 146.0,
      "y": 578.0,
      "w": 108,
      "h": 151,
      "psdRect": [1382, 1936, 1599, 2238]
    },
    "r_sleeve": {
      "index": 35,
      "key": "r_sleeve",
      "originalName": "R sleeve",
      "file": "assets/vora_e1/r_sleeve.png?v=2",
      "x": 475.5,
      "y": 574.5,
      "w": 100,
      "h": 163,
      "psdRect": [2041, 1929, 2242, 2255]
    },
    "l_arm_skin_full": {
      "index": 6,
      "key": "l_arm_skin_full",
      "originalName": "Viewer-Left Full Arm (R upper arm + L F arm + Lhand)",
      "file": "assets/vora_e1/l_arm_skin_full.png?v=2",
      "x": 94.0,
      "y": 695.0,
      "w": 140,
      "h": 395,
      "psdRect": [1278, 2170, 1559, 2960]
    },
    "r_arm_skin_full": {
      "index": 7,
      "key": "r_arm_skin_full",
      "originalName": "Viewer-Right Full Arm (L Upper arm + R F arm + R hand)",
      "file": "assets/vora_e1/r_arm_skin_full.png?v=2",
      "x": 463.0,
      "y": 721.5,
      "w": 134,
      "h": 360,
      "psdRect": [2016, 2223, 2284, 2942]
    },
    "l_forearm_normal": {
      "index": 6,
      "key": "l_forearm_normal",
      "originalName": "L F arm",
      "file": "assets/vora_e1/l_forearm_normal.png?v=1",
      "x": 94.0,
      "y": 779.0,
      "w": 131,
      "h": 311,
      "psdRect": [1278, 2338, 1540, 2960]
    },
    "r_forearm_normal": {
      "index": 7,
      "key": "r_forearm_normal",
      "originalName": "R F arm",
      "file": "assets/vora_e1/r_forearm_normal.png?v=1",
      "x": 463.0,
      "y": 762.5,
      "w": 134,
      "h": 318,
      "psdRect": [2016, 2305, 2284, 2942]
    },
    "backhair_classic": {
      "index": 501,
      "key": "backhair_classic",
      "originalName": "Classic_backhair",
      "file": "assets/vora_slots/back_hair/classic.png?v=1",
      "x": 26.0,
      "y": 234.0,
      "w": 651,
      "h": 806,
      "psdRect": [1142, 1248, 2444, 2861]
    },
    "backhair_short": {
      "index": 502,
      "key": "backhair_short",
      "originalName": "Shorat_backhair",
      "file": "assets/vora_slots/back_hair/short.png?v=1",
      "x": 121.0,
      "y": 308.0,
      "w": 494,
      "h": 280,
      "psdRect": [1332, 1396, 2321, 1956]
    },
    "arm_l_upper": {
      "index": 510,
      "key": "arm_l_upper",
      "originalName": "L upper arm",
      "file": "assets/vora_slots/arms/l_upper_arm.png?v=1",
      "x": 167.5,
      "y": 695.0,
      "w": 86,
      "h": 104,
      "psdRect": [1425, 2170, 1597, 2379]
    },
    "arm_r_upper": {
      "index": 511,
      "key": "arm_r_upper",
      "originalName": "R upper arm",
      "file": "assets/vora_slots/arms/r_upper_arm.png?v=1",
      "x": 469.5,
      "y": 721.5,
      "w": 84,
      "h": 80,
      "psdRect": [2029, 2223, 2197, 2384]
    },
    "arm_l_down": {
      "index": 512,
      "key": "arm_l_down",
      "originalName": "L arm",
      "file": "assets/vora_slots/arms/l_arm.png?v=1",
      "x": 128.5,
      "y": 779.0,
      "w": 116,
      "h": 228,
      "psdRect": [1347, 2338, 1579, 2793]
    },
    "arm_r_down": {
      "index": 513,
      "key": "arm_r_down",
      "originalName": "R arm",
      "file": "assets/vora_slots/arms/r_arm.png?v=1",
      "x": 479.5,
      "y": 778.0,
      "w": 96,
      "h": 214,
      "psdRect": [2049, 2336, 2242, 2764]
    },
    "hand_l_down": {
      "index": 514,
      "key": "hand_l_down",
      "originalName": "Lhand",
      "file": "assets/vora_slots/arms/l_hand.png?v=1",
      "x": 117.5,
      "y": 985.0,
      "w": 59,
      "h": 106,
      "psdRect": [1325, 2750, 1443, 2963]
    },
    "hand_r_down": {
      "index": 515,
      "key": "hand_r_down",
      "originalName": "R hand",
      "file": "assets/vora_slots/arms/r_hand.png?v=1",
      "x": 541.0,
      "y": 978.5,
      "w": 56,
      "h": 102,
      "psdRect": [2172, 2737, 2284, 2942]
    },
    "arm_fo_think": {
      "index": 516,
      "key": "arm_fo_think",
      "originalName": "Fo arm ",
      "file": "assets/vora_slots/arms/fo_arm.png?v=1",
      "x": 169.0,
      "y": 513.0,
      "w": 206,
      "h": 310,
      "psdRect": [1428, 1806, 1840, 2427]
    },
    "arm_r_fo_think": {
      "index": 517,
      "key": "arm_r_fo_think",
      "originalName": "R fo arm ",
      "file": "assets/vora_slots/arms/r_fo_arm.png?v=1",
      "x": 195.5,
      "y": 718.0,
      "w": 357,
      "h": 106,
      "psdRect": [1481, 2216, 2195, 2428]
    },
    "student_body": {
      "index": 520,
      "key": "student_body",
      "originalName": "Body",
      "file": "assets/vora_slots/outfits/student/body.png?v=1",
      "x": 224.5,
      "y": 528.0,
      "w": 271,
      "h": 370,
      "psdRect": [1539, 1836, 2081, 2575]
    },
    "student_l_sleeve": {
      "index": 521,
      "key": "student_l_sleeve",
      "originalName": "L sleeve",
      "file": "assets/vora_slots/outfits/student/l_sleeve.png?v=1",
      "x": 149.0,
      "y": 561.5,
      "w": 141,
      "h": 214,
      "psdRect": [1388, 1903, 1670, 2331]
    },
    "student_r_sleeve": {
      "index": 522,
      "key": "student_r_sleeve",
      "originalName": "R sleeve",
      "file": "assets/vora_slots/outfits/student/r_sleeve.png?v=1",
      "x": 466.5,
      "y": 584.5,
      "w": 101,
      "h": 196,
      "psdRect": [2023, 1949, 2225, 2342]
    },
    "student_skirt": {
      "index": 523,
      "key": "student_skirt",
      "originalName": "Skirt",
      "file": "assets/vora_slots/outfits/student/skirt.png?v=1",
      "x": 153.0,
      "y": 840.0,
      "w": 428,
      "h": 491,
      "psdRect": [1396, 2460, 2253, 3442]
    },
    "student_l_leg": {
      "index": 524,
      "key": "student_l_leg",
      "originalName": "L lrg",
      "file": "assets/vora_slots/outfits/student/l_leg.png?v=1",
      "x": 259.5,
      "y": 1286.0,
      "w": 106,
      "h": 330,
      "psdRect": [1609, 3352, 1822, 4012]
    },
    "student_r_leg": {
      "index": 525,
      "key": "student_r_leg",
      "originalName": "R leg",
      "file": "assets/vora_slots/outfits/student/r_leg.png?v=1",
      "x": 355.0,
      "y": 1279.0,
      "w": 109,
      "h": 334,
      "psdRect": [1800, 3338, 2018, 4006]
    },
    "student_neck": {
      "index": 526,
      "key": "student_neck",
      "originalName": "Neck",
      "file": "assets/vora_slots/outfits/student/neck.png?v=1",
      "x": 317.0,
      "y": 512.5,
      "w": 105,
      "h": 120,
      "psdRect": [1724, 1805, 1934, 2046]
    },
    "student_backcollar": {
      "index": 527,
      "key": "student_backcollar",
      "originalName": "Backcollar",
      "file": "assets/vora_slots/outfits/student/backcollar.png?v=1",
      "x": 306.0,
      "y": 535.0,
      "w": 116,
      "h": 68,
      "psdRect": [1702, 1850, 1935, 1987]
    },
    "student_l_back_sleeve": {
      "index": 528,
      "key": "student_l_back_sleeve",
      "originalName": "L back sleeve",
      "file": "assets/vora_slots/outfits/student/l_back_sleeve.png?v=1",
      "x": 475.0,
      "y": 743.5,
      "w": 86,
      "h": 40,
      "psdRect": [2040, 2267, 2213, 2347]
    },
    "student_r_back_sleeve": {
      "index": 529,
      "key": "student_r_back_sleeve",
      "originalName": "R Back sleeve",
      "file": "assets/vora_slots/outfits/student/r_back_sleeve.png?v=1",
      "x": 150.0,
      "y": 722.0,
      "w": 104,
      "h": 58,
      "psdRect": [1390, 2224, 1597, 2339]
    },
    "highcer_body": {
      "index": 530,
      "key": "highcer_body",
      "originalName": "Body ",
      "file": "assets/vora_slots/outfits/highcer/body.png?v=1",
      "x": 158.0,
      "y": 534.0,
      "w": 384,
      "h": 478,
      "psdRect": [1406, 1848, 2174, 2805]
    },
    "highcer_l_f_arm": {
      "index": 531,
      "key": "highcer_l_f_arm",
      "originalName": "L F arm ",
      "file": "assets/vora_slots/outfits/highcer/l_f_arm.png?v=1",
      "x": 148.0,
      "y": 577.0,
      "w": 100,
      "h": 164,
      "psdRect": [1386, 1934, 1586, 2261]
    },
    "highcer_r_sleeve": {
      "index": 532,
      "key": "highcer_r_sleeve",
      "originalName": "R sleeve",
      "file": "assets/vora_slots/outfits/highcer/r_sleeve.png?v=1",
      "x": 475.5,
      "y": 574.5,
      "w": 102,
      "h": 168,
      "psdRect": [2041, 1929, 2244, 2266]
    },
    "highcer_lower_body": {
      "index": 533,
      "key": "highcer_lower_body",
      "originalName": "Lower nody Copy",
      "file": "assets/vora_slots/outfits/highcer/lower_body.png?v=1",
      "x": 170.0,
      "y": 929.0,
      "w": 352,
      "h": 686,
      "psdRect": [1430, 2638, 2134, 4010]
    },
    "highcer_neck": {
      "index": 534,
      "key": "highcer_neck",
      "originalName": "Neck ",
      "file": "assets/vora_slots/outfits/highcer/neck.png?v=1",
      "x": 317.0,
      "y": 512.5,
      "w": 96,
      "h": 98,
      "psdRect": [1724, 1805, 1917, 2001]
    },
    "highcer_headband": {
      "index": 535,
      "key": "highcer_headband",
      "originalName": "Headband",
      "file": "assets/vora_slots/outfits/highcer/headband.png?v=1",
      "x": 123.5,
      "y": 66.5,
      "w": 492,
      "h": 220,
      "psdRect": [1337, 913, 2321, 1354]
    },
    "acc_eyeglasses": {
      "index": 540,
      "key": "acc_eyeglasses",
      "originalName": "Eyeglasses",
      "file": "assets/vora_slots/accessories/eyeglasses.png?v=1",
      "x": 190.5,
      "y": 333.5,
      "w": 338,
      "h": 60,
      "psdRect": [1471, 1447, 2147, 1566],
      "blendMode": "multiply"
    },
    "acc_headphone": {
      "index": 541,
      "key": "acc_headphone",
      "originalName": "Head phone",
      "file": "assets/vora_slots/accessories/headphone.png?v=1",
      "x": 76.0,
      "y": 24.5,
      "w": 596,
      "h": 458,
      "psdRect": [1242, 829, 2434, 1745],
      "blendMode": "source-over"
    }
  }
};

// ============================================================================
// VORA SLOT & CUSTOMIZATION CONFIG (Outfit, BackHair, Accessories, Arms, Physics)
// Add new outfits, back hair styles, or accessories here using only asset + config!
// ============================================================================
const VORA_SLOT_CONFIG = {
  defaultOutfit: 'Vora_Student_uni',
  defaultBackHair: 'classic',
  defaultArmPose: 'down',
  defaultAccessories: [],

  // Slot "Accessories" (ของสวมใส่เพิ่มเติมจาก Eyeglasses & Headphone.psd)
  accessories: {
    eyeglasses: {
      id: 'eyeglasses',
      label: 'แว่นตา (Eyeglasses)',
      sourcePsd: 'Eyeglasses & Headphone.psd',
      psdLayer: 'Eyeglasses',
      partKey: 'acc_eyeglasses',
      slot: 'face_front',
      blendMode: 'multiply',
      replacesHeadband: false,
      defaultEnabled: false
    },
    headphone: {
      id: 'headphone',
      label: 'หูฟัง (Head phone)',
      sourcePsd: 'Eyeglasses & Headphone.psd',
      psdLayer: 'Head phone',
      partKey: 'acc_headphone',
      slot: 'head_top',
      blendMode: 'source-over',
      replacesHeadband: true,
      defaultEnabled: false
    }
  },

  // Slot "BackHair" (ทรงผมหลัง): แยกอิสระจากชุด ใช้ค่า physics ต่อทรงผม
  backHairs: {
    classic: {
      id: 'classic',
      label: 'Classic Long (ผมยาวมาตรฐาน)',
      partKey: 'backhair_classic',
      fallbackPartKey: 'back_hair',
      layerMapping: {
        Vora_Student_uni: 'Classic_backhair',
        Vora_Highcer_uni: 'Classic＿Backhair',
        Vora_Default: 'B H Copy'
      },
      pivot: [365.0, 560.0],
      headFollowRatio: 0.68,
      physics: {
        driveScale: 1.25,
        breathWaveAmp: 0.012,
        breathPhaseLag: 1.20,
        stiffness: 20.0,
        damping: 5.2,
        maxAngleRad: 0.038,
        renderScale: 0.55,
        patFollowScale: 0.45,
        flutterAmp: 0.0020,
        flutterFreq: 2.2
      }
    },
    short: {
      id: 'short',
      label: 'Short Bob (ผมสั้น)',
      partKey: 'backhair_short',
      layerMapping: {
        Vora_Student_uni: 'Shorat_backhair',
        Vora_Highcer_uni: 'short back'
      },
      pivot: [365.0, 560.0],
      headFollowRatio: 0.82,
      // ผมสั้นกว่ามาก: แกว่งน้อยกว่า (driveScale/renderScale ต่ำกว่า) และตอบสนองเร็วกว่า (stiffness/damping สูงกว่า)
      physics: {
        driveScale: 0.55,
        breathWaveAmp: 0.0045,
        breathPhaseLag: 0.65,
        stiffness: 46.0,
        damping: 9.2,
        maxAngleRad: 0.016,
        renderScale: 0.30,
        patFollowScale: 0.22,
        flutterAmp: 0.0008,
        flutterFreq: 3.1
      }
    }
  },

  // Slot "Arms" (ใช้ร่วมทุกชุด มี 2 ท่า: down และ think)
  arms: {
    timing: {
      idleRandomMinIntervalMs: 8000,   // สุ่มทุก 8–20 วินาทีในสถานะ Idle
      idleRandomMaxIntervalMs: 20000,
      idleThinkHoldMinMs: 2000,        // ค้างท่า think 2–4 วินาทีแล้วกลับเป็น down
      idleThinkHoldMaxMs: 4000,
      transitionDurationMs: 420        // เวลา cross-fade เปลี่ยนท่าอย่างนุ่มนวล
    },
    sharedUpperArms: {
      left: { key: 'arm_l_upper', psdLayer: 'L upper arm', anchor: 'torso' },
      right: { key: 'arm_r_upper', psdLayer: 'R upper arm', anchor: 'torso' }
    },
    poses: {
      down: {
        id: 'down',
        poseCode: 'POSE_NORMAL',
        label: 'ปล่อยแขน (Down)',
        parts: {
          l_arm: { key: 'arm_l_down', psdLayer: 'L arm', pivot: [195.0, 712.0] },
          r_arm: { key: 'arm_r_down', psdLayer: 'R arm', pivot: [510.0, 728.0] },
          l_hand: { key: 'hand_l_down', psdLayer: 'Lhand', pivot: [195.0, 712.0] },
          r_hand: { key: 'hand_r_down', psdLayer: 'R hand', pivot: [510.0, 728.0] }
        }
      },
      think: {
        id: 'think',
        poseCode: 'POSE_THINKING',
        label: 'กอดอก มือแตะคาง (Think)',
        parts: {
          r_fo_arm: { key: 'arm_r_fo_think', psdLayer: 'R fo arm ', anchor: 'torso_front' },
          fo_arm: { key: 'arm_fo_think', psdLayer: 'Fo arm ', anchor: 'chin_front', pivot: [195.0, 745.0] }
        }
      }
    }
  },

  // Slot "Outfit" (สลับตามชุด): กำหนดรายการชิ้นส่วน ลำดับวาด จุดผูก และค่า physics
  outfits: {
    Vora_Student_uni: {
      id: 'Vora_Student_uni',
      label: 'ชุดนักศึกษา (Vora_Student_uni)',
      sourcePsd: 'Vora_Student_uni.psd',
      useLegacyRigRender: false,
      headband: {
        enabled: false,
        key: 'headband'
      },
      parts: {
        l_leg:         { key: 'student_l_leg',         psdLayer: 'L lrg',         slot: 'lower_legs',  pivot: [365.0, 1612.0] },
        r_leg:         { key: 'student_r_leg',         psdLayer: 'R leg',         slot: 'lower_legs',  pivot: [365.0, 1612.0] },
        skirt:         { key: 'student_skirt',         psdLayer: 'Skirt',         slot: 'skirt',       pivot: [365.0, 865.0] },
        backcollar:    { key: 'student_backcollar',    psdLayer: 'Backcollar',    slot: 'back_torso',  pivot: [365.0, 560.0] },
        l_back_sleeve: { key: 'student_l_back_sleeve', psdLayer: 'L back sleeve', slot: 'back_sleeve', pivot: [485.0, 735.0] },
        r_back_sleeve: { key: 'student_r_back_sleeve', psdLayer: 'R Back sleeve', slot: 'back_sleeve', pivot: [195.0, 722.0] },
        body:          { key: 'student_body',          psdLayer: 'Body',          slot: 'torso',       pivot: [365.0, 945.0] },
        l_sleeve:      { key: 'student_l_sleeve',      psdLayer: 'L sleeve',      slot: 'front_sleeve', pivot: [225.0, 585.0] },
        r_sleeve:      { key: 'student_r_sleeve',      psdLayer: 'R sleeve',      slot: 'front_sleeve', pivot: [480.0, 595.0] },
        neck:          { key: 'student_neck',          psdLayer: 'Neck',          slot: 'neck',        pivot: [365.0, 560.0] }
      },
      physics: {
        // Skirt: แกว่งมากที่สุด ชายกระโปรงตามหลังลำตัว
        skirt: {
          enabled: true,
          stiffness: 18.0,
          damping: 4.5,
          driveScale: 1.55,
          breathWaveAmp: 0.0085,
          maxAngleRad: 0.032,
          shearXScale: 6.5
        },
        // L/R sleeve และ back sleeve: แกว่งเล็กน้อย
        sleeve: {
          enabled: true,
          stiffness: 32.0,
          damping: 6.8,
          driveScale: 0.55,
          breathWaveAmp: 0.0032,
          maxAngleRad: 0.012
        },
        backSleeve: {
          enabled: true,
          stiffness: 30.0,
          damping: 6.4,
          driveScale: 0.65,
          breathWaveAmp: 0.0038,
          maxAngleRad: 0.014
        },
        // Backcollar: แกว่งน้อยมาก
        backcollar: {
          enabled: true,
          stiffness: 48.0,
          damping: 9.5,
          driveScale: 0.18,
          breathWaveAmp: 0.0009,
          maxAngleRad: 0.0035
        }
      }
    },

    Vora_Highcer_uni: {
      id: 'Vora_Highcer_uni',
      label: 'ชุด ปวส. / พิธีการ (Vora_Highcer_uni)',
      sourcePsd: 'Vora_Highcer_uni.psd',
      useLegacyRigRender: false,
      headband: {
        enabled: true,
        key: 'highcer_headband'
      },
      parts: {
        // "Lower nody Copy" ผูกกับสะโพกเป็นชิ้นเดียว ห้ามแยกเลเยอร์เอง
        lower_body: { key: 'highcer_lower_body', psdLayer: 'Lower nody Copy', slot: 'lower_unified', pivot: [365.0, 945.0] },
        body:       { key: 'highcer_body',       psdLayer: 'Body ',           slot: 'torso',         pivot: [365.0, 945.0] },
        l_sleeve:   { key: 'highcer_l_f_arm',    psdLayer: 'L F arm ',        slot: 'front_sleeve',  pivot: [225.0, 585.0] },
        r_sleeve:   { key: 'highcer_r_sleeve',   psdLayer: 'R sleeve',        slot: 'front_sleeve',  pivot: [480.0, 585.0] },
        neck:       { key: 'highcer_neck',       psdLayer: 'Neck ',           slot: 'neck',          pivot: [365.0, 560.0] }
      },
      physics: {
        // "L F arm ", R sleeve แกว่งเล็กน้อย
        sleeve: {
          enabled: true,
          stiffness: 34.0,
          damping: 7.0,
          driveScale: 0.50,
          breathWaveAmp: 0.0028,
          maxAngleRad: 0.010
        },
        // ปลายขากางเกงแกว่งน้อยมาก
        pantsHem: {
          enabled: true,
          stiffness: 45.0,
          damping: 9.0,
          driveScale: 0.22,
          breathWaveAmp: 0.0012,
          maxAngleRad: 0.0040
        }
      }
    },

    Vora_Default: {
      id: 'Vora_Default',
      label: 'ชุดต้นฉบับ (Vora Original Rig)',
      sourcePsd: 'VoraE1.psd + Vora.psd',
      useLegacyRigRender: true,
      headband: {
        enabled: true,
        key: 'headband'
      },
      parts: {
        hip:        { key: 'hip',        psdLayer: 'Hip',             slot: 'lower_hip' },
        leg_l:      { key: 'leg_l',      psdLayer: 'L Leg',           slot: 'lower_legs' },
        leg_r:      { key: 'leg_r',      psdLayer: 'R leg',           slot: 'lower_legs' },
        lower_body: { key: 'lower_body', psdLayer: 'Lower nody Copy', slot: 'lower_unified' },
        body:       { key: 'upper_body', psdLayer: 'Body Copy',       slot: 'torso' },
        l_sleeve:   { key: 'l_sleeve',   psdLayer: 'L sleeve',        slot: 'front_sleeve' },
        r_sleeve:   { key: 'r_sleeve',   psdLayer: 'R sleeve',        slot: 'front_sleeve' },
        neck:       { key: 'neck',       psdLayer: 'Neck Copy',       slot: 'neck' }
      },
      physics: {
        sleeve: {
          enabled: false,
          stiffness: 34.0,
          damping: 7.0,
          driveScale: 0.0,
          breathWaveAmp: 0.0,
          maxAngleRad: 0.0
        }
      }
    }
  }
};

if (typeof window !== 'undefined') {
  window.VORA_SLOT_CONFIG = VORA_SLOT_CONFIG;
}

class VoraLiveRig {
  constructor(canvasOrId, options = {}) {
    this.canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
    if (!this.canvas) {
      throw new Error('VoraLiveRig: target canvas not found');
    }
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.manifest = VORA_RIG_MANIFEST;

    this.width = this.manifest.canvas.width;   // 710
    this.height = this.manifest.canvas.height; // 1650
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.options = Object.assign({
      breathPeriodSec: 3.6,     // 3–4 seconds per breathing cycle
      blinkMinIntervalMs: 3000, // 3–6 seconds random blink interval
      blinkMaxIntervalMs: 6000,
      blinkMinDurationMs: 165,  // 150–250ms total close + open time
      blinkMaxDurationMs: 235,
      doubleBlinkProb: 0.18,    // occasional natural double blink
      enableCursorGaze: true,   // gentle eye contact awareness with mouse when camera is off
      armMotionScale: 1.0,      // intensity multiplier for arm & hand animation (0.5x – 2.5x)
      legMotionScale: 1.25,     // intensity multiplier for natural leg & stance dynamics (0.5x – 2.5x)
      zoomMode: 'full',         // 'full' | 'face' | 'bust'
      showDebugPivots: false
    }, options);

    // Offscreen buffers for left & right eyes
    this.eyeBufferL = document.createElement('canvas');
    this.eyeBufferL.width = 220;
    this.eyeBufferL.height = 140;
    this.eyeCtxL = this.eyeBufferL.getContext('2d');

    this.eyeBufferR = document.createElement('canvas');
    this.eyeBufferR.width = 220;
    this.eyeBufferR.height = 140;
    this.eyeCtxR = this.eyeBufferR.getContext('2d');

    // Scratch buffer for clipping lower eyelashes cleanly during full blink
    this.lashScratch = document.createElement('canvas');
    this.lashScratch.width = 220;
    this.lashScratch.height = 140;
    this.lashScratchCtx = this.lashScratch.getContext('2d');

    this.images = {};
    this.loadedCount = 0;
    this.totalCount = Object.keys(this.manifest.parts).length;
    this.isReady = false;
    this.isRunning = false;
    this.rafId = null;

    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this._fpsFrames = 0;
    this._fpsLastCheck = this.startTime;

    // Animation & Secondary Physics state
    this.state = {
      breathNorm: 0,
      breathLag: 0,
      bodySwayX: 0,
      bodyTiltDeg: 0,
      shoulderRollDeg: 0,
      armSecondaryRotDeg: 0,
      armSlowShiftY: 0,
      armSlowShiftX: 0,
      lUpperArmDeg: 0,
      rUpperArmDeg: 0,
      rForearmDeg: 0,
      lChinForearmDeg: 0,
      armGestureLabel: 'Breathing & Natural Sway',
      speakingArmEnv: 0,
      headTiltDeg: 0,
      headSwayX: 0,
      chestLiftY: 0,
      headLiftY: 0,
      browLiftY: 0,
      // Multi-strand spring-damper states (Front Bangs, Side Tails, Back Hair)
      hairFrontAngle: 0,
      hairFrontVel: 0,
      hairTailAngle: 0,
      hairTailVel: 0,
      hairBackAngle: 0,
      hairBackVel: 0,
      // Dual-arm spring-damper physics (Right crossed forearm + Left chin forearm/hand)
      armSpringAngle: 0,
      armSpringVel: 0,
      chinArmSpringAngle: 0,
      chinArmSpringVel: 0,
      // Outfit & Cloth secondary physics states (Skirt, Front Sleeves, Back Sleeves, Backcollar, Pants Hem)
      skirtAngle: 0,
      skirtVel: 0,
      sleeveAngle: 0,
      sleeveVel: 0,
      backSleeveAngle: 0,
      backSleeveVel: 0,
      collarAngle: 0,
      collarVel: 0,
      pantsHemAngle: 0,
      pantsHemVel: 0,
      // Active Slot IDs & Thinking Lock State
      currentOutfit: options.initialOutfit || VORA_SLOT_CONFIG.defaultOutfit,
      currentBackHair: options.initialBackHair || VORA_SLOT_CONFIG.defaultBackHair,
      isThinkingAnswer: false,
      blinkAmount: 0,
      blinkCount: 0,
      lastBlinkType: 'Single',
      gazeX: 0,            // current smoothed eyeball offset X (in scaled canvas px)
      gazeY: 0,            // current smoothed eyeball offset Y (in scaled canvas px)
      gazeStateLabel: 'Direct Eye Contact (Default)',
      isSpeaking: false,
      mouthOpen: 0,        // kept 0 (mouth 100% static as required)
      cameraTrackingActive: false,
      faceDetected: false,
      faceNormX: 0,
      faceNormY: 0,
      faceProximity: 0,
      faceCount: 0,
      uptimeSec: 0,
      fps: 60,
      // Character Interaction Animation (Startle -> Raise Arms -> Shy Gaze Aversion -> Smooth Return)
      reactActive: false,
      reactPhaseLabel: 'Idle',
      reactBodyJoltY: 0,
      reactBodySwayX: 0,
      reactBodyTiltDeg: 0,
      reactHeadJoltY: 0,
      reactHeadSwayX: 0,
      reactHeadTiltDeg: 0,
      reactArmLiftY: 0,
      reactArmRotDeg: 0,
      reactChinArmRotDeg: 0,
      reactBrowLiftY: 0,
      reactShyLidDrop: 0,
      reactGazeWeight: 0,
      interactionCount: 0,
      lastDialogue: '',
      // Unified Animation State & Interactive Head Pat System (Multi-Pose + Emotion)
      animState: 'IDLE', // 'IDLE' | 'HEAD_PAT_START' | 'HEAD_PAT_ACTIVE' | 'HEAD_PAT_LONG' | 'HEAD_PAT_RELEASE'
      currentPose: options.initialPose || HEAD_PAT_CONFIG.defaultPose,
      queuedPose: null,
      poseTransitioning: false,
      thinkingBlend: (options.initialPose === 'POSE_THINKING') ? 1.0 : 0.0,
      headPatActive: false,
      headPatHover: false,
      headPatDurationSec: 0,
      patHeadTiltDeg: 0,
      patHeadSwayX: 0,
      patHeadDropY: 0,
      patBodyTiltDeg: 0,
      patBodySwayX: 0,
      patHairTailOffsetDeg: 0,
      patHairBangOffsetDeg: 0,
      patArmLiftY: 0,
      patArmTiltDeg: 0,
      patEyeClosure: 0,
      patBrowDropY: 0,
      patGazePauseWeight: 0,
      speakHeadBobY: 0,
      speakHeadTiltDeg: 0,
      speakBrowLiftY: 0,
      normalEyeOpacity: 1.0,
      headPatEyeOpacity: 0.0,
      smileMouthOpacity: 1.0,
      speakMouth2Opacity: 0.0,
      speakMouth2ScaleX: 1.0,
      speakMouth2ScaleY: 1.0,
      patMouth3Opacity: 0.0,
      activeEyeLayerLabel: 'Eyesemote 1',
      activeMouthLayerLabel: 'Smile 1',
      headPatCount: 0,
      lastHeadPatDialogue: '',
      showDebugHitbox: Boolean(options.showDebugHitbox)
    };

    // Layer Manager per-layer runtime state (visibility, opacity, transform overrides)
    this.layerOverrides = {};

    // Multi-Pose Manager (POSE_NORMAL / 'down' <-> POSE_THINKING / 'think')
    const initialPoseId = (options.initialPose === 'POSE_THINKING' || options.initialPose === 'think')
      ? 'POSE_THINKING'
      : 'POSE_NORMAL';
    const armTiming = VORA_SLOT_CONFIG.arms.timing;
    this.poseCtrl = {
      currentPose: initialPoseId,
      targetPose: initialPoseId,
      queuedPose: null,
      transitioning: false,
      transitionStartAt: 0,
      transitionDurationMs: armTiming.transitionDurationMs || HEAD_PAT_CONFIG.timing.poseTransitionMs,
      fromBlend: initialPoseId === 'POSE_THINKING' ? 1.0 : 0.0,
      toBlend: initialPoseId === 'POSE_THINKING' ? 1.0 : 0.0,
      thinkingBlend: initialPoseId === 'POSE_THINKING' ? 1.0 : 0.0,
      isThinkingAnswer: false,
      autoRandomPose: options.autoRandomPose !== false,
      nextRandomPoseAt: performance.now() + this._randRange(
        armTiming.idleRandomMinIntervalMs,
        armTiming.idleRandomMaxIntervalMs
      ),
      randomThinkingReturnAt: 0
    };

    // Slot Manager (Outfit + BackHair + Accessories — independent hot-swapping without resetting animation/physics)
    const initOutfit = (options.initialOutfit && VORA_SLOT_CONFIG.outfits[options.initialOutfit])
      ? options.initialOutfit
      : VORA_SLOT_CONFIG.defaultOutfit;
    const initBackHair = (options.initialBackHair && VORA_SLOT_CONFIG.backHairs[options.initialBackHair])
      ? options.initialBackHair
      : VORA_SLOT_CONFIG.defaultBackHair;
    const initAccs = {};
    Object.keys(VORA_SLOT_CONFIG.accessories || {}).forEach((accId) => {
      const cfg = VORA_SLOT_CONFIG.accessories[accId];
      initAccs[accId] = Boolean(cfg && cfg.defaultEnabled);
    });
    if (Array.isArray(options.initialAccessories)) {
      options.initialAccessories.forEach((accId) => {
        if (initAccs[accId] !== undefined) initAccs[accId] = true;
      });
    } else if (options.initialAccessories && typeof options.initialAccessories === 'object') {
      Object.keys(options.initialAccessories).forEach((accId) => {
        if (initAccs[accId] !== undefined) initAccs[accId] = Boolean(options.initialAccessories[accId]);
      });
    }
    this.slotCtrl = {
      outfitId: initOutfit,
      backHairId: initBackHair,
      accessories: initAccs
    };
    this.state.currentOutfit = initOutfit;
    this.state.currentBackHair = initBackHair;
    this.state.activeAccessories = Object.keys(initAccs).filter(k => initAccs[k]);

    // Single-Point Eye Controller (Arbitrates Blink, Eyelid Squeeze 0->35%->65%/100%, and 'head pat' cross-fade)
    this.eyeCtrl = {
      squeezeAmount: 0.0,         // 0.0 (open) .. 1.0 (closed) on Eyesemote 1
      preSwapSqueeze: 0.65,       // saved squeeze % before swapping to 'head pat' layer
      normalEyeOpacity: 1.0,      // opacity of 'Eyesemote 1' offscreen buffers
      headPatEyeOpacity: 0.0,     // opacity of 'head pat' > 'L eyelash' layer
      usingHeadPatLayer: false,
      lettingBlinkFinish: false,
      blinkFinishDeadline: 0
    };

    // Single-Point Mouth Controller (Arbitrates Smile 1, speaking mouth 2 lip-sync, and Head Pat mouth 3)
    this.mouthCtrl = {
      smileOpacity: 1.0,
      mouth2Opacity: 0.0,
      mouth2ScaleX: 1.0,
      mouth2ScaleY: 1.0,
      mouth3Opacity: 0.0,
      syllableOpen: 0.0,
      speakStartAt: 0,
      activeLayer: 'mouth_smile'
    };

    // Autonomous & Triggered Arm Micro-Gesture Controller
    this.armGestureCtrl = {
      active: false,
      style: 'ponder', // 'ponder' | 'adjust' | 'sway'
      startAt: 0,
      durationMs: 2200,
      nextGestureAt: performance.now() + this._randRange(3500, 6200),
      lastStyleIdx: -1
    };

    // Character Interaction (Mouse Click Startle & Shy Reaction) state machine
    this.interactionCtrl = {
      active: false,
      startAt: 0,
      durationMs: 2450,
      shyDir: -1,
      shyTargetX: -6.6,
      shyTargetY: 2.3,
      dialogues: [
        'มีอะไรให้ช่วยมั้ยคะ?',
        'เอ๊~ มีอะไรรึเปล่าคะ?'
      ],
      lastDialogueIdx: -1
    };

    // Interactive Head Pat System State Machine
    // PSD Head Bounds: x 1332–2327, y 842–1834 -> Rig Canvas (710x1650): x 121.0–618.5, y 31.0–527.0
    const psdHB = HEAD_PAT_CONFIG.hitbox.psdBounds;
    const crop = this.manifest.cropOrigin;
    const sc = this.manifest.scale;
    const hbXMin = (psdHB.left - crop.x) * sc;   // 121.0
    const hbXMax = (psdHB.right - crop.x) * sc;  // 618.5
    const hbYMin = (psdHB.top - crop.y) * sc;    // 31.0
    const hbYMax = (psdHB.bottom - crop.y) * sc; // 527.0

    this.headPatCtrl = {
      state: 'IDLE', // 'IDLE' | 'HEAD_PAT_START' | 'HEAD_PAT_ACTIVE' | 'HEAD_PAT_LONG' | 'HEAD_PAT_RELEASE'
      isDown: false,
      pointerId: null,
      startAt: 0,
      lastMoveAt: 0,
      durationSec: 0,
      patNormX: 0,
      patNormY: 0,
      prevPatNormX: 0,
      strokeVelocityX: 0,
      strokeSpeed: 0,
      strokeDistance: 0,
      longEnteredAt: 0,
      longDialogueTriggered: false,
      suppressNextClick: false,
      lastReleaseAt: 0,
      patCount: 0,
      longPatCount: 0,
      lastLongDialogue: '',
      longDialogues: HEAD_PAT_CONFIG.poses.POSE_THINKING.dialogue.lines,
      lastLongDialogueIdx: -1,
      hitbox: {
        xMin: hbXMin,
        xMax: hbXMax,
        yMin: hbYMin,
        yMax: hbYMax,
        width: hbXMax - hbXMin,
        height: hbYMax - hbYMin,
        centerX: (hbXMin + hbXMax) * 0.5, // 369.75
        centerY: (hbYMin + hbYMax) * 0.5, // 279.0
        halfWidth: (hbXMax - hbXMin) * 0.5,  // 248.75
        halfHeight: (hbYMax - hbYMin) * 0.5  // 248.0
      }
    };

    // Blink controller state machine
    this.blinkCtrl = {
      phase: 'open',
      nextBlinkAt: performance.now() + this._randRange(3000, 5200),
      phaseStartAt: 0,
      currentDurationMs: 195,
      pendingSecondBlink: false,
      lastWasDouble: false
    };

    // Eye Contact, Camera Face Target & Micro-Glance controller
    this.gazeCtrl = {
      mode: 'direct',
      targetX: 0,
      targetY: 0,
      nextEventAt: performance.now() + this._randRange(2600, 4800),
      returnToDirectAt: 0,
      cursorNormX: 0,
      cursorNormY: 0,
      lastCursorMoveAt: 0,
      camActive: false,
      camFaceDetected: false,
      camNormX: 0,
      camNormY: 0,
      camFaceArea: 0,
      camFaceCount: 0,
      lastFaceSeenAt: 0
    };

    this._initCursorTracking();
    this._initHeadPatInteraction();
    this._initDebugPanel();
    this._loadAllLayers();
  }

  _randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  // ==========================================================================
  // Layer Manager API (Show / Hide / Opacity / Transform / Availability)
  // ==========================================================================
  hasLayer(key) {
    return Boolean(key && this.manifest.parts[key] && this.images[key]);
  }

  getLayerState(key) {
    if (!this.layerOverrides[key]) {
      this.layerOverrides[key] = {
        visible: true,
        opacity: 1.0,
        dx: 0,
        dy: 0,
        rotDeg: 0,
        scaleX: 1.0,
        scaleY: 1.0
      };
    }
    return this.layerOverrides[key];
  }

  showLayer(key) {
    const st = this.getLayerState(key);
    st.visible = true;
    if (st.opacity <= 0) st.opacity = 1.0;
  }

  hideLayer(key) {
    const st = this.getLayerState(key);
    st.visible = false;
  }

  setLayerOpacity(key, opacity) {
    const st = this.getLayerState(key);
    st.opacity = Math.max(0, Math.min(1, Number(opacity) || 0));
    st.visible = st.opacity > 0.001;
  }

  setLayerTransform(key, transform = {}) {
    const st = this.getLayerState(key);
    if (transform.dx !== undefined) st.dx = transform.dx;
    if (transform.dy !== undefined) st.dy = transform.dy;
    if (transform.rotDeg !== undefined) st.rotDeg = transform.rotDeg;
    if (transform.scaleX !== undefined) st.scaleX = transform.scaleX;
    if (transform.scaleY !== undefined) st.scaleY = transform.scaleY;
  }

  // ==========================================================================
  // Slot & Customization API: setOutfit(id), setBackHair(id), setThinkingState(active)
  // ==========================================================================
  getOutfit() {
    return this.slotCtrl.outfitId;
  }

  getOutfitConfig(outfitId = this.slotCtrl.outfitId) {
    return VORA_SLOT_CONFIG.outfits[outfitId] || VORA_SLOT_CONFIG.outfits[VORA_SLOT_CONFIG.defaultOutfit];
  }

  getBackHair() {
    return this.slotCtrl.backHairId;
  }

  getBackHairConfig(backHairId = this.slotCtrl.backHairId) {
    return VORA_SLOT_CONFIG.backHairs[backHairId] || VORA_SLOT_CONFIG.backHairs[VORA_SLOT_CONFIG.defaultBackHair];
  }

  /**
   * Switches character outfit slot ("Vora_Student_uni", "Vora_Highcer_uni", "Vora_Default", or any newly registered outfit)
   * without resetting animation, emote, current arm pose, or physics state of unchanged parts.
   */
  setOutfit(id) {
    let targetId = String(id || '').trim();
    if (!VORA_SLOT_CONFIG.outfits[targetId]) {
      const lower = targetId.toLowerCase();
      if (lower.includes('student')) targetId = 'Vora_Student_uni';
      else if (lower.includes('highcer') || lower.includes('high')) targetId = 'Vora_Highcer_uni';
      else if (lower.includes('default') || lower.includes('orig')) targetId = 'Vora_Default';
    }
    if (!VORA_SLOT_CONFIG.outfits[targetId]) {
      console.warn('VoraLiveRig.setOutfit: unknown outfit id:', id);
      return { status: 'invalid', outfit: this.slotCtrl.outfitId };
    }

    const prevId = this.slotCtrl.outfitId;
    this.slotCtrl.outfitId = targetId;
    this.state.currentOutfit = targetId;

    // Reset only the outfit-specific cloth springs when outfit changes; keep hair/head/arm/eye/emote untouched
    if (prevId !== targetId) {
      this.state.skirtAngle = 0;
      this.state.skirtVel = 0;
      this.state.sleeveAngle = 0;
      this.state.sleeveVel = 0;
      this.state.backSleeveAngle = 0;
      this.state.backSleeveVel = 0;
      this.state.collarAngle = 0;
      this.state.collarVel = 0;
      this.state.pantsHemAngle = 0;
      this.state.pantsHemVel = 0;
    }

    if (typeof this.options.onOutfitChange === 'function') {
      this.options.onOutfitChange({ outfit: targetId, previousOutfit: prevId });
    }
    if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
      this.canvas.dispatchEvent(new CustomEvent('vora:outfitchange', {
        detail: { outfit: targetId, previousOutfit: prevId }
      }));
    }
    return { status: 'switched', outfit: targetId };
  }

  /**
   * Switches character back hair slot ("classic", "short", or any newly registered hairstyle)
   * independently of outfit, without resetting animation, emote, arm pose, or other physics.
   */
  setBackHair(id) {
    let targetId = String(id || '').trim();
    if (!VORA_SLOT_CONFIG.backHairs[targetId]) {
      const lower = targetId.toLowerCase();
      if (lower.includes('short') || lower.includes('shorat')) targetId = 'short';
      else if (lower.includes('classic') || lower.includes('long')) targetId = 'classic';
    }
    if (!VORA_SLOT_CONFIG.backHairs[targetId]) {
      console.warn('VoraLiveRig.setBackHair: unknown backHair id:', id);
      return { status: 'invalid', backHair: this.slotCtrl.backHairId };
    }

    const prevId = this.slotCtrl.backHairId;
    this.slotCtrl.backHairId = targetId;
    this.state.currentBackHair = targetId;

    if (typeof this.options.onBackHairChange === 'function') {
      this.options.onBackHairChange({ backHair: targetId, previousBackHair: prevId });
    }
    if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
      this.canvas.dispatchEvent(new CustomEvent('vora:backhairchange', {
        detail: { backHair: targetId, previousBackHair: prevId }
      }));
    }
    return { status: 'switched', backHair: targetId };
  }

  /**
   * Returns active accessories state map or array of enabled accessory IDs.
   */
  getAccessories() {
    return Object.assign({}, this.slotCtrl.accessories);
  }

  hasAccessory(id) {
    const key = this._resolveAccessoryId(id);
    return Boolean(key && this.slotCtrl.accessories[key]);
  }

  _resolveAccessoryId(id) {
    const raw = String(id || '').trim();
    if (VORA_SLOT_CONFIG.accessories[raw]) return raw;
    const lower = raw.toLowerCase();
    if (lower.includes('glass') || lower.includes('eye')) return 'eyeglasses';
    if (lower.includes('headphone') || lower.includes('head phone') || lower.includes('phone')) return 'headphone';
    return null;
  }

  /**
   * Equips or unequips a wearable accessory ("eyeglasses", "headphone") without resetting animation or physics.
   */
  setAccessory(id, enabled = true) {
    const accId = this._resolveAccessoryId(id);
    if (!accId || !VORA_SLOT_CONFIG.accessories[accId]) {
      console.warn('VoraLiveRig.setAccessory: unknown accessory id:', id);
      return { status: 'invalid', accessories: this.getAccessories() };
    }
    const nextVal = Boolean(enabled);
    this.slotCtrl.accessories[accId] = nextVal;
    this.state.activeAccessories = Object.keys(this.slotCtrl.accessories).filter(k => this.slotCtrl.accessories[k]);

    if (typeof this.options.onAccessoryChange === 'function') {
      this.options.onAccessoryChange({
        accessory: accId,
        enabled: nextVal,
        activeAccessories: this.state.activeAccessories
      });
    }
    if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
      this.canvas.dispatchEvent(new CustomEvent('vora:accessorychange', {
        detail: {
          accessory: accId,
          enabled: nextVal,
          activeAccessories: this.state.activeAccessories
        }
      }));
    }
    return {
      status: 'updated',
      accessory: accId,
      enabled: nextVal,
      activeAccessories: this.state.activeAccessories
    };
  }

  toggleAccessory(id) {
    const accId = this._resolveAccessoryId(id);
    if (!accId) return { status: 'invalid', accessories: this.getAccessories() };
    return this.setAccessory(accId, !this.slotCtrl.accessories[accId]);
  }

  setAccessories(accessoryListOrMap) {
    Object.keys(this.slotCtrl.accessories).forEach((k) => {
      this.slotCtrl.accessories[k] = false;
    });
    if (Array.isArray(accessoryListOrMap)) {
      accessoryListOrMap.forEach((item) => {
        const accId = this._resolveAccessoryId(item);
        if (accId) this.slotCtrl.accessories[accId] = true;
      });
    } else if (accessoryListOrMap && typeof accessoryListOrMap === 'object') {
      Object.keys(accessoryListOrMap).forEach((k) => {
        const accId = this._resolveAccessoryId(k);
        if (accId) this.slotCtrl.accessories[accId] = Boolean(accessoryListOrMap[k]);
      });
    }
    this.state.activeAccessories = Object.keys(this.slotCtrl.accessories).filter(k => this.slotCtrl.accessories[k]);
    if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
      this.canvas.dispatchEvent(new CustomEvent('vora:accessorychange', {
        detail: { activeAccessories: this.state.activeAccessories }
      }));
    }
    return { status: 'updated', activeAccessories: this.state.activeAccessories };
  }

  /**
   * Enters or exits the "กำลังคิดคำตอบ" (AI Thinking Answer) state:
   * - When active=true: switches to 'think' (POSE_THINKING) and holds it; blocks random Idle pose switching.
   * - When active=false: returns to 'down' (POSE_NORMAL) and resets the Idle random timer (8–20s).
   */
  setThinkingState(isThinking) {
    const active = Boolean(isThinking);
    const pc = this.poseCtrl;
    const armTiming = VORA_SLOT_CONFIG.arms.timing;
    pc.isThinkingAnswer = active;
    this.state.isThinkingAnswer = active;

    if (active) {
      pc.randomThinkingReturnAt = 0;
      return this.setPose('POSE_THINKING', { fromThinkingState: true });
    } else {
      pc.randomThinkingReturnAt = 0;
      const res = this.setPose('POSE_NORMAL', { fromThinkingState: true });
      const now = performance.now();
      pc.nextRandomPoseAt = now + this._randRange(
        armTiming.idleRandomMinIntervalMs,
        armTiming.idleRandomMaxIntervalMs
      );
      return res;
    }
  }

  getArmPose() {
    return this.poseCtrl.targetPose === 'POSE_THINKING' ? 'think' : 'down';
  }

  setArmPose(poseId, options = {}) {
    const p = String(poseId || '').toLowerCase();
    const code = (p === 'think' || p.includes('think')) ? 'POSE_THINKING' : 'POSE_NORMAL';
    return this.setPose(code, options);
  }

  // ==========================================================================
  // Multi-Pose Management (POSE_NORMAL <-> POSE_THINKING with Queue Support)
  // ==========================================================================
  getPose() {
    return this.poseCtrl.currentPose;
  }

  getPoseProfile(poseId = this.poseCtrl.currentPose) {
    return HEAD_PAT_CONFIG.poses[poseId] || HEAD_PAT_CONFIG.poses.POSE_NORMAL;
  }

  /**
   * Switches character pose between 'POSE_NORMAL' ('down') and 'POSE_THINKING' ('think').
   * Per Section 11: If a Head Pat interaction is currently active or releasing (state !== 'IDLE'),
   * the pose change is queued and automatically executed once HEAD_PAT_RELEASE returns to IDLE.
   */
  setPose(poseName, options = {}) {
    const norm = (String(poseName || '').toUpperCase().includes('THINK'))
      ? 'POSE_THINKING'
      : 'POSE_NORMAL';
    const pc = this.poseCtrl;
    const hp = this.headPatCtrl;
    const armTiming = VORA_SLOT_CONFIG.arms.timing;

    // If AI is currently in "กำลังคิดคำตอบ" state, ignore external/random attempts to switch back to normal
    // unless explicitly unlocking via setThinkingState(false) or forceImmediate
    if (pc.isThinkingAnswer && norm === 'POSE_NORMAL' && !options.fromThinkingState && !options.forceImmediate) {
      return { status: 'locked_by_thinking', pose: 'POSE_THINKING' };
    }

    // Queue pose change if Head Pat is currently active or releasing
    if (hp.state !== 'IDLE' && !options.forceImmediate) {
      pc.queuedPose = norm;
      this.state.queuedPose = norm;
      return { status: 'queued', queuedPose: norm };
    }

    pc.queuedPose = null;
    this.state.queuedPose = null;

    const now = performance.now();
    if (!options.isRandomIdle) {
      pc.nextRandomPoseAt = now + this._randRange(
        armTiming.idleRandomMinIntervalMs,
        armTiming.idleRandomMaxIntervalMs
      );
      pc.randomThinkingReturnAt = 0;
    }

    if (pc.targetPose === norm && !pc.transitioning) {
      return { status: 'unchanged', pose: norm };
    }

    pc.targetPose = norm;
    pc.fromBlend = pc.thinkingBlend;
    pc.toBlend = norm === 'POSE_THINKING' ? 1.0 : 0.0;
    pc.transitionDurationMs = options.durationMs !== undefined
      ? options.durationMs
      : (armTiming.transitionDurationMs || HEAD_PAT_CONFIG.timing.poseTransitionMs);

    if (pc.transitionDurationMs <= 0 || Math.abs(pc.toBlend - pc.fromBlend) < 0.01) {
      pc.currentPose = norm;
      pc.thinkingBlend = pc.toBlend;
      pc.transitioning = false;
      this.state.currentPose = norm;
      this.state.poseTransitioning = false;
      this.state.thinkingBlend = pc.thinkingBlend;
    } else {
      pc.transitioning = true;
      pc.transitionStartAt = now;
      this.state.poseTransitioning = true;
    }

    if (typeof this.options.onPoseChange === 'function') {
      this.options.onPoseChange({
        pose: norm,
        armPose: norm === 'POSE_THINKING' ? 'think' : 'down',
        transitioning: pc.transitioning
      });
    }
    if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
      this.canvas.dispatchEvent(new CustomEvent('vora:posechange', {
        detail: {
          pose: norm,
          armPose: norm === 'POSE_THINKING' ? 'think' : 'down',
          transitioning: pc.transitioning
        }
      }));
    }
    return { status: 'switching', pose: norm };
  }

  _initCursorTracking() {
    window.addEventListener('mousemove', (e) => {
      if (!this.options.enableCursorGaze) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const eyeCenterX = rect.left + rect.width * 0.5;
      const eyeCenterY = rect.top + rect.height * 0.28;
      const nx = Math.max(-1, Math.min(1, (e.clientX - eyeCenterX) / (window.innerWidth * 0.45)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - eyeCenterY) / (window.innerHeight * 0.45)));
      this.gazeCtrl.cursorNormX = nx;
      this.gazeCtrl.cursorNormY = ny;
      this.gazeCtrl.lastCursorMoveAt = performance.now();
    }, { passive: true });
  }

  /**
   * Converts viewport (clientX, clientY) into unzoomed 710x1650 Rig Canvas coordinates,
   * accounting for CSS object-fit: contain and active zoomMode ('full' | 'bust' | 'face').
   */
  _clientToRigCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: -1, y: -1 };

    const canvasAspect = this.width / this.height;
    const rectAspect = rect.width / rect.height;
    let renderW = rect.width;
    let renderH = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (rectAspect > canvasAspect) {
      renderW = rect.height * canvasAspect;
      offsetX = (rect.width - renderW) * 0.5;
    } else {
      renderH = rect.width / canvasAspect;
      offsetY = (rect.height - renderH) * 0.5;
    }

    let cx = ((clientX - rect.left - offsetX) / renderW) * this.width;
    let cy = ((clientY - rect.top - offsetY) / renderH) * this.height;

    if (this.options.zoomMode === 'face') {
      cx = (cx - this.width * 0.5) / 2.35 + this.width * 0.5;
      cy = (cy - this.height * 0.25) / 2.35 + this.height * 0.23;
    } else if (this.options.zoomMode === 'bust') {
      cx = (cx - this.width * 0.5) / 1.55 + this.width * 0.5;
      cy = (cy - this.height * 0.35) / 1.55 + this.height * 0.33;
    }

    return { x: cx, y: cy };
  }

  /**
   * Transforms a point in Rig Canvas space into the Head Group's local space
   * by inverting the current head translation (swayX, headY) and head rotation around the Neck pivot.
   * This ensures the Head Hitbox moves and tilts dynamically with Vora's head!
   */
  _getRigKinematics() {
    const st = this.state;
    const clamp = (v, minV, maxV) => Math.max(minV, Math.min(maxV, v));

    const chestY = clamp((st.chestLiftY || 0) + (st.reactBodyJoltY || 0) * 0.45, -5.5, 5.5);
    const bodySwayX = clamp((st.bodySwayX || 0) + (st.reactBodySwayX || 0) * 0.45 + (st.patBodySwayX || 0), -4.2, 4.2);
    const bodyTiltRad = (((st.bodyTiltDeg || 0) + (st.reactBodyTiltDeg || 0) * 0.45 + (st.patBodyTiltDeg || 0)) * Math.PI) / 180;
    const headTiltRad = (((st.headTiltDeg || 0) + (st.reactHeadTiltDeg || 0) * 0.55 + (st.patHeadTiltDeg || 0)) * Math.PI) / 180;
    const torsoRotRad = bodyTiltRad + headTiltRad * 0.16;
    const lowerRotRad = torsoRotRad * 0.28;

    // Waist [365, 945] displacement from Feet [365, 1612] rotation (dy = -667) + breathing sway
    const waistDx = 667.0 * Math.sin(lowerRotRad) + bodySwayX * 0.65;
    const waistDy = -667.0 * (1.0 - Math.cos(lowerRotRad)) + chestY * 0.65;

    // Exact world coordinates of Neck Pivot [365, 560] (dy = -385 from Waist [365, 945])
    const neckWorldX = 365.0 + waistDx + 385.0 * Math.sin(torsoRotRad);
    const neckWorldY = 945.0 + waistDy - 385.0 * Math.cos(torsoRotRad);

    return {
      chestY,
      bodySwayX,
      bodyTiltRad,
      headTiltRad,
      torsoRotRad,
      lowerRotRad,
      waistDx,
      waistDy,
      neckWorldX,
      neckWorldY
    };
  }

  _rigToHeadLocalCoords(rigX, rigY) {
    const piv = this.manifest.pivots.head; // [365.0, 560.0]
    const kin = this._getRigKinematics();

    const dx = rigX - kin.neckWorldX;
    const dy = rigY - kin.neckWorldY;
    const cos = Math.cos(-kin.headTiltRad);
    const sin = Math.sin(-kin.headTiltRad);

    return {
      x: piv[0] + dx * cos - dy * sin,
      y: piv[1] + dx * sin + dy * cos
    };
  }

  _isPointInHeadHitbox(rigX, rigY) {
    const hb = this.headPatCtrl.hitbox;
    const local = this._rigToHeadLocalCoords(rigX, rigY);
    if (local.x < hb.xMin || local.x > hb.xMax || local.y < hb.yMin || local.y > hb.yMax) {
      return false;
    }
    const nx = (local.x - hb.centerX) / hb.halfWidth;
    const ny = (local.y - hb.centerY) / hb.halfHeight;
    return (nx * nx + ny * ny) <= 1.05;
  }

  /**
   * Sets up Pointer Events & Mouse Fallbacks for Interactive Head Pat System:
   * - Starts when user presses down on the Head Hitbox (unless Pose Transition is in progress)
   * - Calls setPointerCapture so dragging outside the Hitbox or character continues tracking
   * - Safely releases on pointerup, pointercancel, lostpointercapture, mouseup, window blur, visibilitychange
   */
  _initHeadPatInteraction() {
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Section 3 & 11: Do not start Head Pat while Pose Transition is in progress
      if (this.poseCtrl.transitioning) return;
      // Prevent overlapping multi-touch interactions
      if (this.headPatCtrl.isDown && this.headPatCtrl.pointerId !== null && this.headPatCtrl.pointerId !== e.pointerId) {
        return;
      }

      const pt = this._clientToRigCoords(e.clientX, e.clientY);
      if (this._isPointInHeadHitbox(pt.x, pt.y)) {
        e.preventDefault();
        const started = this.startHeadPat(pt.x, pt.y, e.pointerId);
        if (started) {
          try {
            this.canvas.setPointerCapture(e.pointerId);
          } catch (_) {
            // Ignore if synthetic event or capture unsupported
          }
        }
      }
    });

    window.addEventListener('pointermove', (e) => {
      const hp = this.headPatCtrl;
      const pt = this._clientToRigCoords(e.clientX, e.clientY);

      if (hp.isDown) {
        if (hp.pointerId !== null && e.pointerId !== undefined && e.pointerId !== hp.pointerId) {
          return;
        }
        // Prevent stuck state if mouse button was released outside browser window
        if (e.pointerType === 'mouse' && e.buttons === 0) {
          this.endHeadPat();
          return;
        }
        this.moveHeadPat(pt.x, pt.y);
      } else {
        const hover = !this.poseCtrl.transitioning && this._isPointInHeadHitbox(pt.x, pt.y);
        this.state.headPatHover = hover;
        this.canvas.style.cursor = hover ? 'grab' : 'pointer';
      }
    }, { passive: true });

    const handleRelease = (e) => {
      const hp = this.headPatCtrl;
      if (!hp.isDown) return;
      if (e && e.pointerId !== undefined && hp.pointerId !== null && e.pointerId !== hp.pointerId) {
        return;
      }
      this.endHeadPat();
    };

    window.addEventListener('pointerup', handleRelease);
    window.addEventListener('pointercancel', handleRelease);
    window.addEventListener('mouseup', () => {
      if (this.headPatCtrl.isDown) this.endHeadPat();
    });
    this.canvas.addEventListener('lostpointercapture', () => {
      if (this.headPatCtrl.isDown) this.endHeadPat();
    });
    this.canvas.addEventListener('mouseleave', (e) => {
      if (!this.headPatCtrl.isDown) {
        this.state.headPatHover = false;
        this.canvas.style.cursor = 'pointer';
      } else if (e.buttons === 0) {
        this.endHeadPat();
      }
    });
    window.addEventListener('blur', () => {
      if (this.headPatCtrl.isDown) this.endHeadPat();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.headPatCtrl.isDown) this.endHeadPat();
    });
  }

  /**
   * Starts Head Pat Interaction (State: HEAD_PAT_START).
   * If called during HEAD_PAT_RELEASE, smoothly resumes from current interpolated values without jumping.
   */
  startHeadPat(rigX, rigY, pointerId = null) {
    if (this.poseCtrl.transitioning) return false;
    const now = performance.now();
    const hp = this.headPatCtrl;
    const hb = hp.hitbox;

    // Prevent overlapping interaction if already held down with a different pointer
    if (hp.isDown && hp.pointerId !== null && pointerId !== null && hp.pointerId !== pointerId) {
      return false;
    }

    // Head Pat takes priority over Click-Startle interaction to prevent any animation conflict
    if (this.interactionCtrl.active) {
      this.interactionCtrl.active = false;
      this.state.reactActive = false;
      this.state.reactPhaseLabel = 'Idle';
    }

    // Section 10: If an auto-blink is currently in progress, let it finish (<= 150ms) before eye squeeze takes over
    if (this.blinkCtrl.phase !== 'open') {
      this.eyeCtrl.lettingBlinkFinish = true;
      this.eyeCtrl.blinkFinishDeadline = now + HEAD_PAT_CONFIG.timing.maxBlinkFinishMs;
      this.blinkCtrl.pendingSecondBlink = false;
    } else {
      this.eyeCtrl.lettingBlinkFinish = false;
    }

    hp.isDown = true;
    hp.pointerId = pointerId;
    hp.startAt = now;
    hp.lastMoveAt = now;
    hp.durationSec = 0;
    hp.state = 'HEAD_PAT_START';
    hp.longEnteredAt = 0;
    hp.longDialogueTriggered = false;
    hp.suppressNextClick = true;
    hp.strokeDistance = 0;
    hp.strokeSpeed = 0;
    hp.strokeVelocityX = 0;
    hp.patCount++;

    const local = this._rigToHeadLocalCoords(rigX, rigY);
    const normX = Math.max(-1.0, Math.min(1.0, (local.x - hb.centerX) / (hb.halfWidth * 0.78)));
    const normY = Math.max(-1.0, Math.min(1.0, (local.y - hb.centerY) / hb.halfHeight));
    hp.patNormX = normX;
    hp.patNormY = normY;
    hp.prevPatNormX = normX;

    this.state.animState = 'HEAD_PAT_START';
    this.state.headPatActive = true;
    this.state.headPatDurationSec = 0;
    this.state.headPatCount = hp.patCount;
    this.canvas.style.cursor = 'grabbing';

    // Gentle initial hair spring touch response (clamped)
    this.state.hairFrontVel = Math.max(-0.16, Math.min(0.16, this.state.hairFrontVel + normX * 0.035));

    if (typeof this.options.onHeadPatStart === 'function') {
      this.options.onHeadPatStart({
        count: hp.patCount,
        pose: this.poseCtrl.currentPose
      });
    }
    return true;
  }

  /**
   * Updates pointer coordinates during active Head Pat (works inside & outside Hitbox while held)
   */
  moveHeadPat(rigX, rigY) {
    const hp = this.headPatCtrl;
    if (!hp.isDown) return;
    const now = performance.now();
    const hb = hp.hitbox;

    // Normalize X relative to head center (-1 left to +1 right)
    const headCenterX = hb.centerX + (this.state.headSwayX || 0);
    const normX = Math.max(-1.0, Math.min(1.0, (rigX - headCenterX) / (hb.halfWidth * 0.78)));
    const normY = Math.max(-1.0, Math.min(1.0, (rigY - hb.centerY) / hb.halfHeight));
    const deltaX = normX - hp.patNormX;
    const dtMove = Math.max(0.004, (now - hp.lastMoveAt) / 1000);

    hp.prevPatNormX = hp.patNormX;
    hp.patNormX = normX;
    hp.patNormY = normY;
    hp.lastMoveAt = now;
    hp.strokeVelocityX = Math.max(-1.0, Math.min(1.0, (deltaX / dtMove) * 0.08));
    hp.strokeDistance += Math.abs(deltaX);
    hp.strokeSpeed = Math.min(1.0, hp.strokeSpeed * 0.7 + Math.abs(deltaX) * 4.5);

    // Impart gentle secondary motion to hair springs as user strokes left/right
    if (Math.abs(deltaX) > 0.002) {
      const impulse = Math.max(-0.07, Math.min(0.07, deltaX * 0.14));
      this.state.hairFrontVel = Math.max(-0.20, Math.min(0.20, this.state.hairFrontVel + impulse * 0.75));
      this.state.hairTailVel  = Math.max(-0.24, Math.min(0.24, this.state.hairTailVel + impulse * 1.05));
      this.state.hairBackVel  = Math.max(-0.18, Math.min(0.18, this.state.hairBackVel + impulse * 0.55));
    }
  }

  /**
   * Releases Head Pat Interaction (Transitions to HEAD_PAT_RELEASE -> IDLE)
   */
  endHeadPat() {
    const hp = this.headPatCtrl;
    if (!hp.isDown && hp.state === 'IDLE') return;

    const now = performance.now();
    const wasUsingHeadPatLayer = this.eyeCtrl.headPatEyeOpacity > 0.05;
    if (wasUsingHeadPatLayer) {
      // Section 9: When releasing from 'head pat' layer, start Eyesemote 1 at pre-swap squeeze (~65%)
      // so the eyes never pop open abruptly during the cross-fade back!
      this.eyeCtrl.squeezeAmount = Math.max(
        this.eyeCtrl.squeezeAmount,
        this.eyeCtrl.preSwapSqueeze || HEAD_PAT_CONFIG.eyelidSqueeze.activeTargetNormal
      );
    }

    hp.isDown = false;
    if (hp.pointerId !== null) {
      try {
        if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(hp.pointerId)) {
          this.canvas.releasePointerCapture(hp.pointerId);
        }
      } catch (_) {}
    }
    hp.pointerId = null;
    hp.lastReleaseAt = now;
    hp.strokeSpeed = 0;
    hp.strokeVelocityX = 0;
    hp.state = 'HEAD_PAT_RELEASE';

    this.state.animState = 'HEAD_PAT_RELEASE';
    this.state.headPatActive = false;
    this.canvas.style.cursor = this.state.headPatHover ? 'grab' : 'pointer';

    // Schedule next natural blink smoothly after eyes finish opening
    this.blinkCtrl.phase = 'open';
    this.blinkCtrl.nextBlinkAt = now + this._randRange(2400, 4600);

    if (typeof this.options.onHeadPatEnd === 'function') {
      this.options.onHeadPatEnd({
        durationSec: hp.durationSec,
        longTriggered: hp.longDialogueTriggered,
        pose: this.poseCtrl.currentPose
      });
    }
    if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
      this.canvas.dispatchEvent(new CustomEvent('vora:headpatend', {
        detail: {
          durationSec: hp.durationSec,
          longTriggered: hp.longDialogueTriggered,
          pose: this.poseCtrl.currentPose
        }
      }));
    }
  }

  /**
   * Returns true and consumes the flag if the most recent click originated from a Head Pat gesture,
   * preventing conflict between Head Pat release and Body Click Startle reaction.
   */
  consumeHeadPatClickSuppression() {
    const hp = this.headPatCtrl;
    if (hp.suppressNextClick || hp.isDown || (performance.now() - hp.lastReleaseAt < 260)) {
      hp.suppressNextClick = false;
      return true;
    }
    return false;
  }

  setCameraFaceTarget(data) {
    const gc = this.gazeCtrl;
    gc.camActive = Boolean(data.cameraActive);
    this.state.cameraTrackingActive = gc.camActive;

    if (data.detected) {
      gc.camFaceDetected = true;
      gc.camNormX = Math.max(-1, Math.min(1, data.normX || 0));
      gc.camNormY = Math.max(-1, Math.min(1, data.normY || 0));
      gc.camFaceArea = data.area || 0;
      gc.camFaceCount = data.count || 1;
      gc.lastFaceSeenAt = performance.now();

      this.state.faceDetected = true;
      this.state.faceNormX = gc.camNormX;
      this.state.faceNormY = gc.camNormY;
      this.state.faceProximity = gc.camFaceArea;
      this.state.faceCount = gc.camFaceCount;
    } else {
      if (!gc.camActive || performance.now() - gc.lastFaceSeenAt > 420) {
        gc.camFaceDetected = false;
        this.state.faceDetected = false;
        this.state.faceProximity = 0;
        this.state.faceCount = 0;
      }
    }
  }

  _loadAllLayers() {
    const parts = this.manifest.parts;
    const keys = Object.keys(parts);
    keys.forEach((key) => {
      const img = new Image();
      img.onload = () => {
        this.loadedCount++;
        if (this.loadedCount >= this.totalCount) {
          this.isReady = true;
          if (typeof this.options.onReady === 'function') {
            this.options.onReady(this);
          }
          this.start();
        }
      };
      img.onerror = (err) => {
        console.error('VoraLiveRig failed to load layer:', key, parts[key].file, err);
      };
      img.src = parts[key].file;
      this.images[key] = img;
    });
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    const loop = (now) => {
      if (!this.isRunning) return;
      this.update(now);
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setSpeaking(speaking) {
    const nextSpeaking = Boolean(speaking);
    if (nextSpeaking && !this.state.isSpeaking) {
      this.mouthCtrl.speakStartAt = 0; // Anchored to exact `now` timestamp on next update(now)
    }
    this.state.isSpeaking = nextSpeaking;
    if (!nextSpeaking) {
      this.mouthCtrl.speakStartAt = 0;
      this.state.mouthOpen = 0;
    }
  }

  setArmMotionScale(scale) {
    const val = parseFloat(scale);
    if (Number.isFinite(val)) {
      this.options.armMotionScale = Math.max(0.3, Math.min(2.8, val));
    }
  }

  /**
   * Triggers a natural arm & hand posture gesture ('ponder' | 'adjust' | 'sway')
   */
  triggerArmGesture(forcedStyle = null) {
    const now = performance.now();
    const ag = this.armGestureCtrl;
    const styles = ['ponder', 'adjust', 'sway'];
    let picked = forcedStyle;
    if (!picked || !styles.includes(picked)) {
      let idx = Math.floor(Math.random() * styles.length);
      if (idx === ag.lastStyleIdx) idx = (idx + 1) % styles.length;
      ag.lastStyleIdx = idx;
      picked = styles[idx];
    }

    ag.active = true;
    ag.style = picked;
    ag.startAt = now;
    ag.durationMs = picked === 'ponder' ? 2350 : (picked === 'adjust' ? 2100 : 2400);
    ag.nextGestureAt = now + ag.durationMs + this._randRange(3400, 5800);

    // Impart gentle physical impulse to both forearm springs
    this.state.armSpringVel = Math.max(-5.5, Math.min(5.5, this.state.armSpringVel + (picked === 'adjust' ? 2.8 : 1.9)));
    this.state.chinArmSpringVel = Math.max(-6.5, Math.min(6.5, this.state.chinArmSpringVel + (picked === 'ponder' ? 3.4 : -2.2)));

    return picked;
  }

  setZoomMode(mode) {
    this.options.zoomMode = mode;
  }

  triggerBlink(forceDouble = false) {
    const now = performance.now();
    this.blinkCtrl.phase = 'closing';
    this.blinkCtrl.phaseStartAt = now;
    this.blinkCtrl.currentDurationMs = this._randRange(this.options.blinkMinDurationMs, this.options.blinkMaxDurationMs);
    this.blinkCtrl.pendingSecondBlink = forceDouble;
    this.state.lastBlinkType = forceDouble ? 'Double Blink' : 'Single Blink';
  }

  triggerGlance() {
    const now = performance.now();
    const dirs = [
      { x: -4.4, y: -1.4, label: 'Subtle Glance Left-Up' },
      { x:  4.4, y: -1.2, label: 'Subtle Glance Right-Up' },
      { x: -3.8, y:  1.5, label: 'Subtle Glance Left-Down' },
      { x:  4.0, y:  1.4, label: 'Subtle Glance Right-Down' },
      { x: -4.5, y:  0.0, label: 'Subtle Glance Side' }
    ];
    const pick = dirs[Math.floor(Math.random() * dirs.length)];
    this.gazeCtrl.mode = 'glance';
    this.gazeCtrl.targetX = pick.x;
    this.gazeCtrl.targetY = pick.y;
    this.state.gazeStateLabel = pick.label;
    this.gazeCtrl.returnToDirectAt = now + this._randRange(650, 1200);
    this.gazeCtrl.nextEventAt = now + this._randRange(3200, 5600);
  }

  /**
   * Triggers Character Interaction Animation on Mouse Click:
   * 1. Subtle Startle Flinch (สะดุ้งเล็กน้อย)
   * 2. Raise Both Arms & Forearms Expressively (ยกแขนและขยับมือทั้งสองข้างขึ้นอย่างเป็นธรรมชาติ)
   * 3. Shy Gaze Aversion (หลบสายตาไปด้านข้าง/ก้มหลบสายตาด้วยความเขินอาย)
   * 4. Smooth Return to Idle Animation (ค่อย ๆ กลับสู่ท่าปกติอย่างนุ่มนวล)
   * Returns randomly selected dialogue string ("มีอะไรให้ช่วยมั้ยคะ?" or "เอ๊~ มีอะไรรึเปล่าคะ?")
   */
  triggerInteraction() {
    const now = performance.now();
    const ic = this.interactionCtrl;

    ic.active = true;
    ic.startAt = now;
    ic.durationMs = 2450;

    // Pick shy gaze direction (alternate or randomize left/right downward shy glance)
    ic.shyDir = Math.random() < 0.7 ? -ic.shyDir : ic.shyDir;
    ic.shyTargetX = ic.shyDir * this._randRange(6.2, 7.2);
    ic.shyTargetY = this._randRange(2.0, 2.7);

    // Trigger immediate startle double-blink
    this.triggerBlink(true);

    // Apply soft physical startle impulse to hair & dual arm springs (clamped so it never jerks)
    this.state.hairFrontVel = Math.max(-0.22, Math.min(0.22, this.state.hairFrontVel - ic.shyDir * 0.12));
    this.state.hairTailVel  = Math.max(-0.25, Math.min(0.25, this.state.hairTailVel - ic.shyDir * 0.15));
    this.state.hairBackVel  = Math.max(-0.18, Math.min(0.18, this.state.hairBackVel - ic.shyDir * 0.10));
    this.state.armSpringVel = Math.max(-5.5, Math.min(5.5, this.state.armSpringVel + 3.2));
    this.state.chinArmSpringVel = Math.max(-6.5, Math.min(6.5, this.state.chinArmSpringVel + 3.8));

    // Randomly select dialogue between Pattern 1 and Pattern 2
    const idx = Math.floor(Math.random() * ic.dialogues.length);
    const dialogue = ic.dialogues[idx];
    ic.lastDialogueIdx = idx;

    this.state.interactionCount++;
    this.state.lastDialogue = dialogue;
    this.state.reactActive = true;
    this.state.reactPhaseLabel = 'Startle & Shy Reaction';

    if (typeof this.options.onInteraction === 'function') {
      this.options.onInteraction({
        dialogue,
        count: this.state.interactionCount
      });
    }

    return dialogue;
  }

  update(now) {
    // Clamp delta time to avoid any spring physics spike if tab was inactive
    const dt = Math.min(0.033, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    const elapsedSec = (now - this.startTime) / 1000;
    this.state.uptimeSec = elapsedSec;

    // FPS tracking
    this._fpsFrames++;
    if (now - this._fpsLastCheck >= 500) {
      this.state.fps = Math.min(120, Math.round((this._fpsFrames * 1000) / (now - this._fpsLastCheck)));
      this._fpsFrames = 0;
      this._fpsLastCheck = now;
    }

    // ========================================================================
    // Character Interaction Animation Envelope (Startle -> Raise Arms -> Shy Gaze -> Return)
    // ========================================================================
    const ic = this.interactionCtrl;
    let targetBodyJoltY = 0;
    let targetBodySwayX = 0;
    let targetBodyTilt  = 0;
    let targetHeadJoltY = 0;
    let targetHeadSwayX_react = 0;
    let targetHeadTilt_react  = 0;
    let targetArmLiftY  = 0;
    let targetArmRotDeg = 0;
    let targetChinArmRotDeg = 0;
    let targetBrowReact = 0;
    let targetShyLid    = 0;
    let targetGazeWeight = 0;

    if (ic.active) {
      const rSec = (now - ic.startAt) / 1000;
      const totalSec = ic.durationMs / 1000;

      if (rSec >= totalSec) {
        ic.active = false;
        this.state.reactActive = false;
        this.state.reactPhaseLabel = 'Idle';
      } else {
        this.state.reactActive = true;

        // 1. Startle Flinch Impulse (0.0s – 0.36s): quick upward jolt + slight recoil
        const startleEnv = rSec < 0.36
          ? Math.sin((rSec / 0.36) * Math.PI) * Math.exp(-rSec * 3.5)
          : 0;

        // 2. Shy Hold & Raise-Arms Envelope (rises 0.0–0.28s, holds softly 0.28–1.45s, eases back 1.45–2.45s)
        let shyHoldEnv = 0;
        let armQuiver = 0;
        if (rSec < 0.28) {
          const u = rSec / 0.28;
          shyHoldEnv = 1.0 - Math.pow(1.0 - u, 3); // cubic ease-out
        } else if (rSec < 1.45) {
          armQuiver = Math.sin((rSec - 0.28) * 10.5);
          shyHoldEnv = 1.0 + 0.08 * armQuiver; // gentle shy quiver while raised
        } else {
          const u = Math.min(1.0, (rSec - 1.45) / (totalSec - 1.45));
          shyHoldEnv = 0.5 * (1.0 + Math.cos(u * Math.PI)); // smooth cosine ease-out to 0
        }

        // 3. Shy Gaze Aversion Weight (looks away shyly, then smoothly returns to eye contact)
        if (rSec < 0.18) {
          targetGazeWeight = rSec / 0.18;
        } else if (rSec < 1.60) {
          targetGazeWeight = 1.0;
        } else {
          const u = Math.min(1.0, (rSec - 1.60) / (totalSec - 1.60));
          targetGazeWeight = 0.5 * (1.0 + Math.cos(u * Math.PI));
        }

        if (rSec < 0.32) {
          this.state.reactPhaseLabel = '1. สะดุ้งเล็กน้อย (Startle)';
        } else if (rSec < 1.50) {
          this.state.reactPhaseLabel = '2. ยกแขน & หลบสายตา (Shy Pose)';
        } else {
          this.state.reactPhaseLabel = '3. กลับสู่ท่าปกติ (Returning)';
        }

        // Body & Head startle + shy posture offsets
        targetBodyJoltY = -8.5 * startleEnv - 2.2 * shyHoldEnv;
        targetBodySwayX = -ic.shyDir * (3.2 * startleEnv + 2.4 * shyHoldEnv);
        targetBodyTilt  = -ic.shyDir * (0.75 * startleEnv + 0.55 * shyHoldEnv);

        targetHeadJoltY = -9.5 * startleEnv + 3.4 * shyHoldEnv; // jolts up, then tucks chin shyly
        targetHeadSwayX_react = -ic.shyDir * (3.8 * startleEnv + 3.0 * shyHoldEnv);
        targetHeadTilt_react  =  ic.shyDir * (1.8 * startleEnv - 2.6 * shyHoldEnv);

        // Expressive Raise Both Arms & Forearms (ยกแขนและขยับมือขึ้นอย่างชัดเจนเป็นธรรมชาติ)
        targetArmLiftY      = -18.5 * shyHoldEnv - 6.5 * startleEnv;
        targetArmRotDeg     =  4.6 * shyHoldEnv + 2.2 * startleEnv + 0.65 * armQuiver;
        targetChinArmRotDeg =  5.4 * shyHoldEnv + 2.6 * startleEnv - 0.85 * armQuiver;

        // Expressive shy eyebrows & upper eyelids
        targetBrowReact = -2.8 * startleEnv - 1.6 * shyHoldEnv;
        targetShyLid    =  0.16 * shyHoldEnv;
      }
    }

    // Smoothly interpolate all reaction channels (prevents any jump even on rapid repeated clicks)
    const reactLerp = 1.0 - Math.exp(-dt * 15.0);
    this.state.reactBodyJoltY      += (targetBodyJoltY - this.state.reactBodyJoltY) * reactLerp;
    this.state.reactBodySwayX      += (targetBodySwayX - this.state.reactBodySwayX) * reactLerp;
    this.state.reactBodyTiltDeg    += (targetBodyTilt - this.state.reactBodyTiltDeg) * reactLerp;
    this.state.reactHeadJoltY      += (targetHeadJoltY - this.state.reactHeadJoltY) * reactLerp;
    this.state.reactHeadSwayX      += (targetHeadSwayX_react - this.state.reactHeadSwayX) * reactLerp;
    this.state.reactHeadTiltDeg    += (targetHeadTilt_react - this.state.reactHeadTiltDeg) * reactLerp;
    this.state.reactArmLiftY       += (targetArmLiftY - this.state.reactArmLiftY) * reactLerp;
    this.state.reactArmRotDeg      += (targetArmRotDeg - this.state.reactArmRotDeg) * reactLerp;
    this.state.reactChinArmRotDeg  += (targetChinArmRotDeg - this.state.reactChinArmRotDeg) * reactLerp;
    this.state.reactBrowLiftY      += (targetBrowReact - this.state.reactBrowLiftY) * reactLerp;
    this.state.reactShyLidDrop     += (targetShyLid - this.state.reactShyLidDrop) * reactLerp;
    this.state.reactGazeWeight     += (targetGazeWeight - this.state.reactGazeWeight) * reactLerp;

    // ========================================================================
    // Multi-Pose Manager Update (POSE_NORMAL <-> POSE_THINKING + Random Idle Switch)
    // ========================================================================
    const pc = this.poseCtrl;
    const hp = this.headPatCtrl;
    const armTiming = VORA_SLOT_CONFIG.arms.timing;

    if (pc.transitioning) {
      const pElapsed = now - pc.transitionStartAt;
      const pDur = Math.max(1, pc.transitionDurationMs);
      const u = Math.min(1.0, pElapsed / pDur);
      const ease = u * u * (3.0 - 2.0 * u);
      pc.thinkingBlend = pc.fromBlend + (pc.toBlend - pc.fromBlend) * ease;
      if (u >= 1.0) {
        pc.transitioning = false;
        pc.currentPose = pc.targetPose;
        pc.thinkingBlend = pc.toBlend;
        if (typeof this.options.onPoseChange === 'function') {
          this.options.onPoseChange({
            pose: pc.currentPose,
            armPose: pc.currentPose === 'POSE_THINKING' ? 'think' : 'down',
            transitioning: false
          });
        }
        if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
          this.canvas.dispatchEvent(new CustomEvent('vora:posechange', {
            detail: {
              pose: pc.currentPose,
              armPose: pc.currentPose === 'POSE_THINKING' ? 'think' : 'down',
              transitioning: false
            }
          }));
        }
      }
    } else if (pc.isThinkingAnswer) {
      // สถานะ "กำลังคิดคำตอบ" มีลำดับสำคัญกว่าการสุ่ม ห้ามสุ่มสลับท่าระหว่างคิด และค้างท่า think ไว้
      if (pc.targetPose !== 'POSE_THINKING') {
        this.setPose('POSE_THINKING', { fromThinkingState: true });
      }
    } else if (pc.autoRandomPose && hp.state === 'IDLE' && !ic.active && !this.state.isSpeaking) {
      if (pc.currentPose === 'POSE_NORMAL' && now >= pc.nextRandomPoseAt) {
        const holdDur = this._randRange(
          armTiming.idleThinkHoldMinMs,
          armTiming.idleThinkHoldMaxMs
        );
        this.setPose('POSE_THINKING', { isRandomIdle: true });
        pc.randomThinkingReturnAt = now + (armTiming.transitionDurationMs || 420) + holdDur;
        pc.nextRandomPoseAt = pc.randomThinkingReturnAt + this._randRange(
          armTiming.idleRandomMinIntervalMs,
          armTiming.idleRandomMaxIntervalMs
        );
      } else if (pc.currentPose === 'POSE_THINKING' && pc.randomThinkingReturnAt > 0 && now >= pc.randomThinkingReturnAt) {
        pc.randomThinkingReturnAt = 0;
        this.setPose('POSE_NORMAL', { isRandomIdle: true });
        pc.nextRandomPoseAt = now + this._randRange(
          armTiming.idleRandomMinIntervalMs,
          armTiming.idleRandomMaxIntervalMs
        );
      }
    }

    this.state.currentPose = pc.currentPose;
    this.state.poseTransitioning = pc.transitioning;
    this.state.thinkingBlend = pc.thinkingBlend;
    this.state.queuedPose = pc.queuedPose;

    // ========================================================================
    // Interactive Head Pat System State Machine (Multi-Pose + Emotion)
    // States: IDLE -> HEAD_PAT_START -> HEAD_PAT_ACTIVE -> HEAD_PAT_LONG -> HEAD_PAT_RELEASE -> IDLE
    // ========================================================================
    const poseProfile = this.getPoseProfile(pc.currentPose);
    const cfgTiming = HEAD_PAT_CONFIG.timing;
    const cfgMotion = HEAD_PAT_CONFIG.motion;
    const cfgSqueeze = HEAD_PAT_CONFIG.eyelidSqueeze;

    const hasHeadPatEyeLayer = Boolean(
      poseProfile.headPatEyeLayer &&
      this.hasLayer(poseProfile.headPatEyeLayer) &&
      !poseProfile.eyeFallbackMode
    );
    const hasHeadPatMouthLayer = Boolean(
      poseProfile.headPatMouthLayer &&
      this.hasLayer(poseProfile.headPatMouthLayer)
    );

    let targetPatHeadTiltDeg = 0;
    let targetPatHeadSwayX   = 0;
    let targetPatHeadDropY   = 0;
    let targetPatBodyTiltDeg = 0;
    let targetPatBodySwayX   = 0;
    let targetPatHairTailDeg = 0;
    let targetPatHairBangDeg = 0;
    let targetPatArmLiftY    = 0;
    let targetPatArmTiltDeg  = 0;
    let targetPatEyeClosure  = 0;
    let targetPatBrowDropY   = 0;
    let targetPatGazePause   = 0;
    let targetHeadPatEyeOp   = 0;
    let targetMouth3Op       = 0;

    if (hp.isDown) {
      const holdMs = now - hp.startAt;
      hp.durationSec = holdMs / 1000;
      this.state.headPatDurationSec = hp.durationSec;
      this.state.headPatActive = true;
      hp.strokeSpeed = Math.max(0, hp.strokeSpeed - dt * 1.8);
      hp.strokeVelocityX *= Math.exp(-dt * 10.0);

      if (holdMs < cfgTiming.startDurationMs) {
        hp.state = 'HEAD_PAT_START';
      } else if (holdMs < cfgTiming.longThresholdMs) {
        hp.state = 'HEAD_PAT_ACTIVE';
      } else {
        if (hp.state !== 'HEAD_PAT_LONG') {
          hp.longEnteredAt = now;
        }
        hp.state = 'HEAD_PAT_LONG';
        if (!hp.longDialogueTriggered) {
          hp.longDialogueTriggered = true;
          hp.longPatCount++;

          const dlgCfg = poseProfile.dialogue || HEAD_PAT_CONFIG.poses.POSE_NORMAL.dialogue;
          const lines = (Array.isArray(dlgCfg.lines) && dlgCfg.lines.length > 0)
            ? dlgCfg.lines
            : [dlgCfg.fallbackLine || "I suppose... I don't mind."];

          // Pick non-repeating random line from config
          let dIdx = Math.floor(Math.random() * lines.length);
          if (lines.length > 1 && dIdx === hp.lastLongDialogueIdx) {
            dIdx = (dIdx + 1) % lines.length;
          }
          const longMsg = lines[dIdx];
          hp.lastLongDialogueIdx = dIdx;
          hp.lastLongDialogue = longMsg;
          this.state.lastHeadPatDialogue = dlgCfg.enabled ? longMsg : '';

          // Section 8: Only trigger popup if dialogue.enabled === true for current pose
          if (dlgCfg.enabled) {
            const payload = {
              dialogue: longMsg,
              enabled: true,
              pose: pc.currentPose,
              displayDurationMs: dlgCfg.displayDurationMs || 2600,
              durationSec: hp.durationSec,
              count: hp.longPatCount
            };
            if (typeof this.options.onHeadPatLong === 'function') {
              this.options.onHeadPatLong(payload);
            }
            if (this.canvas && typeof this.canvas.dispatchEvent === 'function') {
              this.canvas.dispatchEvent(new CustomEvent('vora:headpatlong', {
                detail: payload
              }));
            }
          }
        }
      }
      this.state.animState = hp.state;

      // Section 5.1: Head Tilt & Horizontal Shift
      // Default max ±4° (strictly clamped within ±5°), horizontal shift 1–2% of head width
      const maxTilt = Math.min(cfgMotion.hardMaxTiltDeg, cfgMotion.maxTiltDeg);
      const rawTilt = (hp.patNormX * maxTilt) + (hp.strokeVelocityX * 0.85);
      targetPatHeadTiltDeg = Math.max(-cfgMotion.hardMaxTiltDeg, Math.min(cfgMotion.hardMaxTiltDeg, rawTilt));

      const headW = hp.hitbox.width;  // 497.5px
      const headH = hp.hitbox.height; // 496.0px
      const maxShiftPx = headW * Math.min(cfgMotion.hardMaxShiftRatio, cfgMotion.maxShiftRatio); // ~7.46px
      const hardShiftPx = headW * cfgMotion.hardMaxShiftRatio; // 9.95px
      targetPatHeadSwayX = Math.max(-hardShiftPx, Math.min(hardShiftPx, hp.patNormX * maxShiftPx));

      // Section 6.1: Head dips downward ~1% of head height (~5.0px) in HEAD_PAT_LONG
      const longDipPx = headH * cfgMotion.longDipRatio; // ~4.96px
      if (hp.state === 'HEAD_PAT_LONG') {
        targetPatHeadDropY = longDipPx;
      } else {
        targetPatHeadDropY = 1.4 + Math.min(1.0, holdMs / cfgTiming.longThresholdMs) * (longDipPx * 0.55);
      }

      // Section 5.3: Upper body & shoulders follow 1/4 to 1/3 (0.28) of head movement
      const bodyRatio = Math.max(0.25, Math.min(0.333, cfgMotion.bodyFollowRatio));
      targetPatBodyTiltDeg = targetPatHeadTiltDeg * bodyRatio;
      targetPatBodySwayX   = targetPatHeadSwayX * bodyRatio;
      targetPatArmLiftY    = -2.4 - Math.sin(hp.durationSec * 3.0) * 1.6;
      targetPatArmTiltDeg  = hp.patNormX * 1.8 + Math.sin(hp.durationSec * 3.6) * 0.85;

      // Section 5.2: Secondary hair lag offset (L tail / R tail move more than H1–H3 bangs)
      targetPatHairTailDeg = Math.max(
        -cfgMotion.maxHairTailOffsetDeg,
        Math.min(cfgMotion.maxHairTailOffsetDeg, -targetPatHeadTiltDeg * cfgMotion.hairTailFollowRatio)
      );
      targetPatHairBangDeg = Math.max(
        -cfgMotion.maxHairBangOffsetDeg,
        Math.min(cfgMotion.maxHairBangOffsetDeg, -targetPatHeadTiltDeg * cfgMotion.hairBangFollowRatio)
      );

      // Section 6.1 & 6.2: Mouth Expression (Smile 1 -> mouth 3 in POSE_NORMAL; keep Smile 1 in POSE_THINKING)
      targetMouth3Op = hasHeadPatMouthLayer ? 1.0 : 0.0;

      // Section 6.1 & 6.2: Eye Expression (0->35% in 0.4s, 35%->65% at 3s + swap to 'head pat' in POSE_NORMAL; 0->100% in POSE_THINKING)
      if (hp.state === 'HEAD_PAT_START') {
        targetPatEyeClosure = cfgSqueeze.startTarget; // 0.35 (35%)
        targetPatBrowDropY  = 1.1;
        targetHeadPatEyeOp  = 0.0;
      } else if (hp.state === 'HEAD_PAT_ACTIVE') {
        const activeSpan = Math.max(1, cfgTiming.longThresholdMs - cfgTiming.startDurationMs);
        const prog = Math.max(0, Math.min(1, (holdMs - cfgTiming.startDurationMs) / activeSpan));
        const endTarget = hasHeadPatEyeLayer ? cfgSqueeze.activeTargetNormal : cfgSqueeze.activeTargetFallback;
        targetPatEyeClosure = cfgSqueeze.startTarget + prog * (endTarget - cfgSqueeze.startTarget);
        targetPatBrowDropY  = 1.1 + prog * 1.0;
        targetHeadPatEyeOp  = 0.0;
      } else {
        // HEAD_PAT_LONG (>= 3.0s)
        if (hasHeadPatEyeLayer) {
          targetPatEyeClosure = cfgSqueeze.activeTargetNormal; // hold ~65% behind cross-fade
          targetHeadPatEyeOp  = 1.0;                           // cross-fade to 'head pat' > 'L eyelash'
          targetPatBrowDropY  = 2.1;
        } else {
          // Fallback (POSE_THINKING): squeeze eyelids 100% closed
          targetPatEyeClosure = cfgSqueeze.activeTargetFallback; // 1.00 (100%)
          targetHeadPatEyeOp  = 0.0;
          targetPatBrowDropY  = 2.2;
        }
      }

      // Section 10: Pause webcam eye tracking during Head Pat
      targetPatGazePause = 1.0;
    } else if (hp.state === 'HEAD_PAT_RELEASE') {
      this.state.headPatActive = false;
      targetPatEyeClosure = 0.0;
      targetHeadPatEyeOp  = 0.0;
      targetMouth3Op      = 0.0;
      targetPatGazePause  = 0.0;

      const settled = (
        this.eyeCtrl.squeezeAmount < 0.01 &&
        this.eyeCtrl.headPatEyeOpacity < 0.01 &&
        this.mouthCtrl.mouth3Opacity < 0.01 &&
        Math.abs(this.state.patHeadTiltDeg) < 0.03 &&
        Math.abs(this.state.patHeadSwayX) < 0.05 &&
        Math.abs(this.state.patHeadDropY) < 0.05 &&
        this.state.patGazePauseWeight < 0.02
      );

      if (settled) {
        hp.state = 'IDLE';
        hp.durationSec = 0;
        this.eyeCtrl.squeezeAmount = 0;
        this.eyeCtrl.headPatEyeOpacity = 0;
        this.eyeCtrl.normalEyeOpacity = 1;
        this.mouthCtrl.mouth3Opacity = 0;
        this.mouthCtrl.smileOpacity = 1;
        this.state.patEyeClosure = 0;
        this.state.patHeadTiltDeg = 0;
        this.state.patHeadSwayX = 0;
        this.state.patHeadDropY = 0;
        this.state.patBodyTiltDeg = 0;
        this.state.patBodySwayX = 0;
        this.state.patHairTailOffsetDeg = 0;
        this.state.patHairBangOffsetDeg = 0;
        this.state.patGazePauseWeight = 0;
        this.state.headPatDurationSec = 0;
        this.state.animState = 'IDLE';

        // Section 11: Execute queued pose switch as soon as HEAD_PAT_RELEASE returns to IDLE
        if (pc.queuedPose) {
          const nextPose = pc.queuedPose;
          pc.queuedPose = null;
          this.state.queuedPose = null;
          this.setPose(nextPose);
        }
      } else {
        this.state.animState = 'HEAD_PAT_RELEASE';
      }
    } else {
      this.state.animState = 'IDLE';
    }

    // Damped interpolation for Head Pat motion channels
    const patPoseLerp = 1.0 - Math.exp(-dt * (hp.isDown ? cfgMotion.tiltDampingSpeed : cfgMotion.releaseDampingSpeed));
    const patHairLagLerp = 1.0 - Math.exp(-dt * (hp.isDown ? 6.2 : 5.8));
    this.state.patHeadTiltDeg       += (targetPatHeadTiltDeg - this.state.patHeadTiltDeg) * patPoseLerp;
    this.state.patHeadSwayX         += (targetPatHeadSwayX - this.state.patHeadSwayX) * patPoseLerp;
    this.state.patHeadDropY         += (targetPatHeadDropY - this.state.patHeadDropY) * patPoseLerp;
    this.state.patBodyTiltDeg       += (targetPatBodyTiltDeg - this.state.patBodyTiltDeg) * patPoseLerp;
    this.state.patBodySwayX         += (targetPatBodySwayX - this.state.patBodySwayX) * patPoseLerp;
    this.state.patHairTailOffsetDeg += (targetPatHairTailDeg - this.state.patHairTailOffsetDeg) * patHairLagLerp;
    this.state.patHairBangOffsetDeg += (targetPatHairBangDeg - this.state.patHairBangOffsetDeg) * patHairLagLerp;
    this.state.patArmLiftY          += (targetPatArmLiftY - this.state.patArmLiftY) * patPoseLerp;
    this.state.patArmTiltDeg        += (targetPatArmTiltDeg - this.state.patArmTiltDeg) * patPoseLerp;
    this.state.patBrowDropY         += (targetPatBrowDropY - this.state.patBrowDropY) * patPoseLerp;

    // Webcam Gaze Pause / Resume (~200ms smooth blend)
    const gazeBlendRate = 1000 / Math.max(50, cfgTiming.gazePauseBlendMs);
    const gazePauseLerp = 1.0 - Math.exp(-dt * gazeBlendRate * 2.2);
    this.state.patGazePauseWeight   += (targetPatGazePause - this.state.patGazePauseWeight) * gazePauseLerp;

    // Single-Point Mouth Controller (Speaking Lip-Sync 'mouth 2' + Head Pat 'mouth 3' + Default 'Smile 1')
    const mouthStep = (dt * 1000) / Math.max(60, cfgTiming.mouthCrossfadeMs);
    const effectiveTargetMouth3 = this.state.isSpeaking ? 0.0 : targetMouth3Op;
    if (this.mouthCtrl.mouth3Opacity < effectiveTargetMouth3) {
      this.mouthCtrl.mouth3Opacity = Math.min(effectiveTargetMouth3, this.mouthCtrl.mouth3Opacity + mouthStep);
    } else if (this.mouthCtrl.mouth3Opacity > effectiveTargetMouth3) {
      this.mouthCtrl.mouth3Opacity = Math.max(effectiveTargetMouth3, this.mouthCtrl.mouth3Opacity - mouthStep);
    }

    // Conversational Syllable Lip-Sync ('mouth_2' open mouth <-> 'mouth_smile' closed consonant)
    let targetSyllableOpen = 0.0;
    if (this.state.isSpeaking && this.hasLayer('mouth_2')) {
      if (!this.mouthCtrl.speakStartAt || now < this.mouthCtrl.speakStartAt) {
        this.mouthCtrl.speakStartAt = now;
      }
      const spkSec = Math.max(0, (now - this.mouthCtrl.speakStartAt) / 1000);
      const sylGate = Math.sin(spkSec * 16.5) + 0.45 * Math.sin(spkSec * 25.5 + 0.8);
      const vowelMod = 0.75 + 0.25 * Math.cos(spkSec * 7.2);
      // Distinct open syllables interleaved with natural consonant closures
      if (sylGate > 0.08) {
        targetSyllableOpen = Math.max(0.25, Math.min(1.0, (sylGate / 1.25) * vowelMod));
      } else {
        targetSyllableOpen = 0.0;
      }
    }

    const sylRate = targetSyllableOpen > this.mouthCtrl.syllableOpen ? 30.0 : 28.0;
    this.mouthCtrl.syllableOpen += (targetSyllableOpen - this.mouthCtrl.syllableOpen) * (1.0 - Math.exp(-dt * sylRate));
    if (this.mouthCtrl.syllableOpen < 0.015 && !this.state.isSpeaking) {
      this.mouthCtrl.syllableOpen = 0.0;
    }

    const m3Op = this.mouthCtrl.mouth3Opacity;
    const availForSpeech = Math.max(0.0, 1.0 - m3Op);
    const m2Op = availForSpeech * Math.min(1.0, Math.max(0.0, (this.mouthCtrl.syllableOpen - 0.04) * 3.4));
    const smileOp = Math.max(0.0, 1.0 - m3Op - m2Op);

    this.mouthCtrl.mouth2Opacity = m2Op;
    this.mouthCtrl.smileOpacity  = smileOp;
    this.mouthCtrl.mouth2ScaleY  = 0.36 + 0.68 * this.mouthCtrl.syllableOpen;
    this.mouthCtrl.mouth2ScaleX  = 0.94 + 0.08 * this.mouthCtrl.syllableOpen;

    this.state.mouthOpen          = Math.round(this.mouthCtrl.syllableOpen * 100);
    this.state.smileMouthOpacity  = smileOp;
    this.state.speakMouth2Opacity = m2Op;
    this.state.speakMouth2ScaleX  = this.mouthCtrl.mouth2ScaleX;
    this.state.speakMouth2ScaleY  = this.mouthCtrl.mouth2ScaleY;
    this.state.patMouth3Opacity   = m3Op;

    if (m3Op >= 0.5) {
      this.mouthCtrl.activeLayer = 'mouth_3';
      this.state.activeMouthLayerLabel = 'mouth 3 (Head Pat)';
    } else if (this.state.isSpeaking || m2Op >= 0.15) {
      this.mouthCtrl.activeLayer = m2Op >= 0.35 ? 'mouth_2' : 'mouth_smile';
      this.state.activeMouthLayerLabel = `mouth 2 (Speaking ${this.state.mouthOpen}%)`;
    } else {
      this.mouthCtrl.activeLayer = 'mouth_smile';
      this.state.activeMouthLayerLabel = 'Smile 1 (Default)';
    }

    // Single-Point Eye Controller (Eyelid Squeeze + 150–250ms Cross-Fade between Eyesemote 1 & head pat)
    const eyeStep = (dt * 1000) / Math.max(80, cfgTiming.eyeCrossfadeMs);
    if (this.eyeCtrl.headPatEyeOpacity < targetHeadPatEyeOp) {
      this.eyeCtrl.headPatEyeOpacity = Math.min(targetHeadPatEyeOp, this.eyeCtrl.headPatEyeOpacity + eyeStep);
    } else if (this.eyeCtrl.headPatEyeOpacity > targetHeadPatEyeOp) {
      this.eyeCtrl.headPatEyeOpacity = Math.max(targetHeadPatEyeOp, this.eyeCtrl.headPatEyeOpacity - eyeStep);
    }
    this.eyeCtrl.normalEyeOpacity = 1.0 - this.eyeCtrl.headPatEyeOpacity;
    this.eyeCtrl.usingHeadPatLayer = this.eyeCtrl.headPatEyeOpacity >= 0.5;

    // Eyelid squeeze interpolation (waits <= 150ms if a blink was mid-flight when Head Pat started)
    if (this.eyeCtrl.lettingBlinkFinish) {
      if (this.blinkCtrl.phase === 'open' || now >= this.eyeCtrl.blinkFinishDeadline) {
        this.eyeCtrl.lettingBlinkFinish = false;
        this.blinkCtrl.phase = 'open';
        this.state.blinkAmount = 0;
      }
    }
    if (!this.eyeCtrl.lettingBlinkFinish) {
      const squeezeSpeed = hp.isDown ? 7.2 : 6.4;
      const squeezeLerp = 1.0 - Math.exp(-dt * squeezeSpeed);
      this.eyeCtrl.squeezeAmount += (targetPatEyeClosure - this.eyeCtrl.squeezeAmount) * squeezeLerp;
      if (hp.isDown && targetHeadPatEyeOp <= 0.01) {
        this.eyeCtrl.preSwapSqueeze = this.eyeCtrl.squeezeAmount;
      }
    }
    this.state.patEyeClosure     = this.eyeCtrl.squeezeAmount;
    this.state.normalEyeOpacity  = this.eyeCtrl.normalEyeOpacity;
    this.state.headPatEyeOpacity = this.eyeCtrl.headPatEyeOpacity;
    this.state.activeEyeLayerLabel = this.eyeCtrl.headPatEyeOpacity >= 0.5
      ? 'head pat > L eyelash'
      : (poseProfile.eyeFallbackMode && hp.state === 'HEAD_PAT_LONG'
          ? 'Eyesemote 1 (Fallback 100% Squeeze)'
          : 'Eyesemote 1');

    // ========================================================================
    // A. Natural Breathing (3.6s seamless respiratory cycle)
    // ========================================================================
    const T = this.options.breathPeriodSec;
    const omega = (2 * Math.PI) / T;
    const phase = elapsedSec * omega;
    const armScale = this.options.armMotionScale || 1.0;

    // Smooth respiratory waveform (inhale rises gently, exhale settles softly)
    const breathWave = Math.sin(phase) - 0.12 * Math.sin(2 * phase);
    const breathLagWave = Math.sin(phase - 0.34) - 0.12 * Math.sin(2 * (phase - 0.34));
    const breathDeepLag = Math.sin(phase - 0.68) - 0.10 * Math.sin(2 * (phase - 0.68));

    // Sub-harmonics for subtle, non-robotic posture balance & overlapping action
    const subPhase2 = 0.5 * phase;        // 7.2s cycle
    const subPhase3 = (1.0 / 3.0) * phase; // 10.8s cycle

    const tiltWave = Math.sin(subPhase2) * 0.65 + Math.sin(phase - 0.48) * 0.25 + Math.cos(subPhase3) * 0.20;
    const swayWave = Math.cos(subPhase2 - 0.35) * 0.72 + Math.sin(subPhase3) * 0.28;
    const bodyBalanceWave = Math.sin(subPhase2 - 0.2);

    this.state.breathNorm = breathWave;
    this.state.breathLag = breathLagWave;

    const gc = this.gazeCtrl;
    const camActiveScale = 1.0 - Math.max(0, Math.min(1, this.state.patGazePauseWeight || 0));
    const camHeadOffsetX = (gc.camActive && gc.camFaceDetected) ? (gc.camNormX * 3.2 * camActiveScale) : 0;
    const camHeadOffsetY = (gc.camActive && gc.camFaceDetected) ? (gc.camNormY * 1.5 * camActiveScale) : 0;
    const camHeadTiltDeg = (gc.camActive && gc.camFaceDetected) ? (gc.camNormX * 1.15 * camActiveScale) : 0;

    // Lifelike breathing & posture displacements on 710x1650 canvas
    this.state.chestLiftY      = -5.4 * breathWave;                        // vertical chest & shoulder breathing
    this.state.shoulderRollDeg =  1.45 * breathWave * armScale;            // clearly visible shoulder roll & relaxation
    this.state.bodySwayX       =  1.35 * bodyBalanceWave + camHeadOffsetX * 0.20;
    this.state.bodyTiltDeg     =  0.22 * bodyBalanceWave;

    // ========================================================================
    // B. Articulated Arm & Forearm Movement (Upper Arms + Crossed Forearm + Chin Hand)
    // ========================================================================
    // 1. Autonomous Periodic Arm Micro-Gestures (every 3.5–6.0s during Idle)
    const ag = this.armGestureCtrl;
    if (!ag.active && !ic.active && !hp.isDown && now >= ag.nextGestureAt) {
      this.triggerArmGesture();
    }

    let gestureUpperL = 0;
    let gestureUpperR = 0;
    let gestureForeR  = 0;
    let gestureChinL  = 0;
    let gestureShiftY = 0;
    let gestureShiftX = 0;

    if (ag.active) {
      const gSec = (now - ag.startAt) / 1000;
      const gTotal = ag.durationMs / 1000;
      if (gSec >= gTotal) {
        ag.active = false;
        this.state.armGestureLabel = 'Breathing & Natural Sway';
      } else {
        const u = gSec / gTotal;
        // Smooth bell envelope: sin^2(pi * u) with gentle harmonic modulation
        const bell = Math.pow(Math.sin(u * Math.PI), 1.6);
        const osc = Math.sin(u * Math.PI * 2.0);

        if (ag.style === 'ponder') {
          this.state.armGestureLabel = 'Pondering Hand Gesture (ขยับมือแตะคาง)';
          gestureChinL  = (3.2 * bell + 1.1 * osc) * armScale;
          gestureForeR  = (1.8 * bell - 0.6 * osc) * armScale;
          gestureUpperL = (1.4 * bell) * armScale;
          gestureUpperR = (-0.9 * bell) * armScale;
          gestureShiftY = -4.2 * bell * armScale;
          gestureShiftX =  1.8 * bell * armScale;
        } else if (ag.style === 'adjust') {
          this.state.armGestureLabel = 'Crossed-Arm Shift (ขยับแขนคลายเมื่อย)';
          gestureForeR  = (2.9 * bell + 0.9 * osc) * armScale;
          gestureChinL  = (2.4 * bell + 0.8 * osc) * armScale;
          gestureUpperL = (1.8 * bell) * armScale;
          gestureUpperR = (1.8 * bell) * armScale;
          gestureShiftY = -5.5 * bell * armScale;
          gestureShiftX = -1.6 * osc * armScale;
        } else {
          this.state.armGestureLabel = 'Shoulder & Arm Sway (โยกไหล่และแขน)';
          gestureUpperL = (1.6 * osc * bell) * armScale;
          gestureUpperR = (-1.6 * osc * bell) * armScale;
          gestureForeR  = (2.2 * osc * bell) * armScale;
          gestureChinL  = (-2.5 * osc * bell) * armScale;
          gestureShiftY = -3.0 * bell * armScale;
          gestureShiftX =  2.6 * osc * bell * armScale;
        }
      }
    } else {
      this.state.armGestureLabel = this.state.isSpeaking
        ? 'Speaking Hand Cadence (ขยับแขนประกอบการพูด)'
        : 'Breathing & Natural Sway';
    }

    // 2. Conversational Arm Cadence & Head/Brow Dynamics when Vora is Speaking
    const targetSpeakEnv = this.state.isSpeaking ? 1.0 : 0.0;
    this.state.speakingArmEnv += (targetSpeakEnv - this.state.speakingArmEnv) * (1.0 - Math.exp(-dt * 6.0));
    const spk = this.state.speakingArmEnv * armScale;
    const spkWave1 = Math.sin(elapsedSec * 4.2) * spk;
    const spkWave2 = Math.cos(elapsedSec * 2.9 - 0.4) * spk;

    // Conversational Head Nod, Tilt & Eyebrow emphasis
    const sylOpen = (this.state.mouthOpen || 0) / 100;
    const targetSpkNodY = (Math.sin(elapsedSec * 5.2) * 1.35 + Math.sin(elapsedSec * 2.8) * 0.85 + sylOpen * 1.6) * spk;
    const targetSpkTilt = (Math.sin(elapsedSec * 2.4 - 0.4) * 1.15) * spk;
    const targetSpkBrow = (0.55 * Math.sin(elapsedSec * 4.2 - 0.3) + 0.45 * sylOpen) * spk * 1.6;

    this.state.speakHeadBobY    += (targetSpkNodY - this.state.speakHeadBobY) * (1.0 - Math.exp(-dt * 12.0));
    this.state.speakHeadTiltDeg += (targetSpkTilt - this.state.speakHeadTiltDeg) * (1.0 - Math.exp(-dt * 10.0));
    this.state.speakBrowLiftY   += (targetSpkBrow - this.state.speakBrowLiftY) * (1.0 - Math.exp(-dt * 14.0));

    // 3. Upper Arm Rotations (Left & Right shoulders with asymmetric natural phase)
    const baseUpperL = (1.35 * breathWave + 0.75 * Math.sin(subPhase2 - 0.3)) * armScale;
    const baseUpperR = (-1.35 * breathLagWave - 0.70 * Math.cos(subPhase2 - 0.5)) * armScale;
    this.state.lUpperArmDeg = baseUpperL + gestureUpperL + spkWave1 * 1.4 + this.state.reactArmRotDeg * 0.65 + this.state.patArmTiltDeg * 0.45;
    this.state.rUpperArmDeg = baseUpperR - gestureUpperR - spkWave2 * 1.3 - this.state.reactArmRotDeg * 0.65 + this.state.patArmTiltDeg * 0.45;

    // 4. Right Crossed Forearm Spring-Damper (r_forearm)
    const armTargetRot = (
      -1.85 * breathLagWave +
       1.15 * Math.sin(subPhase2 - 0.45) +
       0.65 * Math.cos(subPhase3 - 0.65)
    ) * armScale + gestureForeR + spkWave1 * 2.1 + this.state.patArmTiltDeg * 0.65;

    const armStiff = 30.0;
    const armDamp  = 6.4;
    const armAcc = (armTargetRot - this.state.armSpringAngle) * armStiff - this.state.armSpringVel * armDamp;
    this.state.armSpringVel += armAcc * dt;
    this.state.armSpringAngle = Math.max(-6.5, Math.min(6.5, this.state.armSpringAngle + this.state.armSpringVel * dt));
    this.state.armSecondaryRotDeg = this.state.armSpringAngle;
    this.state.rForearmDeg = this.state.armSpringAngle + this.state.reactArmRotDeg;

    // 5. Left Chin-Resting Forearm & Hand Spring-Damper (l_forearm_chin)
    const chinArmTargetRot = (
       2.15 * breathDeepLag +
       1.35 * Math.cos(subPhase2 - 0.75) +
       0.80 * Math.sin(subPhase3 - 0.25)
    ) * armScale + gestureChinL + spkWave2 * 2.6 + this.state.patArmTiltDeg * 0.80;

    const chinStiff = 34.0;
    const chinDamp  = 6.8;
    const chinAcc = (chinArmTargetRot - this.state.chinArmSpringAngle) * chinStiff - this.state.chinArmSpringVel * chinDamp;
    this.state.chinArmSpringVel += chinAcc * dt;
    this.state.chinArmSpringAngle = Math.max(-7.5, Math.min(7.5, this.state.chinArmSpringAngle + this.state.chinArmSpringVel * dt));
    this.state.lChinForearmDeg = this.state.chinArmSpringAngle + this.state.reactChinArmRotDeg;

    // 6. Vertical & Horizontal Arm Posture Shifts
    this.state.armSlowShiftY = (
      -3.2 * breathLagWave +
       2.1 * Math.sin(subPhase2 - 0.55) +
       1.1 * Math.cos(subPhase3 - 1.1)
    ) * armScale + gestureShiftY - Math.abs(spkWave1) * 2.8 + this.state.patArmLiftY;

    this.state.armSlowShiftX = (
       1.65 * Math.cos(subPhase2 - 0.25) +
       0.85 * Math.sin(subPhase3 - 0.70)
    ) * armScale + gestureShiftX + spkWave2 * 1.5;

    // ========================================================================
    // F. Head Movement (Subtle tilt, conversational nodding & breathing follow-through)
    // ========================================================================
    const targetHeadLiftY = -5.2 * breathLagWave + camHeadOffsetY + this.state.speakHeadBobY;
    const targetHeadSwayX =  1.95 * swayWave + camHeadOffsetX + this.state.speakHeadTiltDeg * 0.40;
    const targetHeadTilt  =  1.05 * tiltWave + camHeadTiltDeg + this.state.speakHeadTiltDeg;

    const prevCombinedHeadX    = this.state.headSwayX + (this._prevPatHeadSwayX || 0);
    const prevCombinedHeadTilt = this.state.headTiltDeg + (this._prevPatHeadTiltDeg || 0);
    this._prevPatHeadSwayX   = this.state.patHeadSwayX;
    this._prevPatHeadTiltDeg = this.state.patHeadTiltDeg;

    const poseLerp = 1.0 - Math.exp(-dt * 6.2);
    this.state.headLiftY   += (targetHeadLiftY - this.state.headLiftY) * poseLerp;
    this.state.headSwayX   += (targetHeadSwayX - this.state.headSwayX) * poseLerp;
    this.state.headTiltDeg += (targetHeadTilt - this.state.headTiltDeg) * poseLerp;

    // ========================================================================
    // C. Multi-Strand Hair Physics (Spring-Damper with Weight & Inertia)
    // ========================================================================
    const currCombinedHeadX    = this.state.headSwayX + this.state.patHeadSwayX;
    const currCombinedHeadTilt = this.state.headTiltDeg + this.state.patHeadTiltDeg;
    const headVelX = (currCombinedHeadX - prevCombinedHeadX) / dt;
    const headVelTilt = (currCombinedHeadTilt - prevCombinedHeadTilt) / dt;
    const headDrive = -headVelX * 0.0015 - headVelTilt * 0.0022 - this.state.patHeadTiltDeg * 0.0018;

    // 1. Front Hair / Bangs Spring (Lighter weight, crisp follow-through)
    const targetFront = headDrive * 0.85 + Math.sin(phase - 0.55) * 0.010;
    const accFront = (targetFront - this.state.hairFrontAngle) * 52.0 - this.state.hairFrontVel * 9.0;
    this.state.hairFrontVel += accFront * dt;
    this.state.hairFrontAngle = Math.max(-0.032, Math.min(0.032, this.state.hairFrontAngle + this.state.hairFrontVel * dt));

    // 2. Side Hair Tails Spring (Medium weight pendulum locks)
    const targetTail = headDrive * 1.15 + Math.sin(phase - 0.85) * 0.014;
    const accTail = (targetTail - this.state.hairTailAngle) * 34.0 - this.state.hairTailVel * 6.5;
    this.state.hairTailVel += accTail * dt;
    this.state.hairTailAngle = Math.max(-0.042, Math.min(0.042, this.state.hairTailAngle + this.state.hairTailVel * dt));

    // 3. Back Hair Spring (Per-BackHair Slot Config: classic vs short)
    const bhCfg = this.getBackHairConfig();
    const bhPhys = (bhCfg && bhCfg.physics) ? bhCfg.physics : {
      driveScale: 1.25,
      breathWaveAmp: 0.012,
      breathPhaseLag: 1.20,
      stiffness: 20.0,
      damping: 5.2,
      maxAngleRad: 0.038
    };
    const targetBack = headDrive * bhPhys.driveScale + Math.sin(phase - bhPhys.breathPhaseLag) * bhPhys.breathWaveAmp;
    const accBack = (targetBack - this.state.hairBackAngle) * bhPhys.stiffness - this.state.hairBackVel * bhPhys.damping;
    this.state.hairBackVel += accBack * dt;
    this.state.hairBackAngle = Math.max(-bhPhys.maxAngleRad, Math.min(bhPhys.maxAngleRad, this.state.hairBackAngle + this.state.hairBackVel * dt));

    // 4. Outfit Cloth Secondary Physics (Driven by same body/head motion inputs & configurable per outfit)
    const prevBodyX = this._prevBodySwayX !== undefined ? this._prevBodySwayX : (this.state.bodySwayX + this.state.patBodySwayX);
    const currBodyX = this.state.bodySwayX + this.state.patBodySwayX + (this.state.reactBodySwayX || 0) * 0.45;
    this._prevBodySwayX = currBodyX;
    const bodyVelX = (currBodyX - prevBodyX) / dt;
    const bodyDrive = -bodyVelX * 0.0022 + headDrive * 0.65;

    const outfitCfg = this.getOutfitConfig();
    const outfitPhys = (outfitCfg && outfitCfg.physics) ? outfitCfg.physics : {};

    // 4a. Skirt Spring (Student: แกว่งมากที่สุด ชายกระโปรงตามหลังลำตัว)
    if (outfitPhys.skirt && outfitPhys.skirt.enabled) {
      const sk = outfitPhys.skirt;
      const targetSkirt = bodyDrive * sk.driveScale + Math.sin(phase - 1.05) * sk.breathWaveAmp;
      const accSkirt = (targetSkirt - this.state.skirtAngle) * sk.stiffness - this.state.skirtVel * sk.damping;
      this.state.skirtVel += accSkirt * dt;
      this.state.skirtAngle = Math.max(-sk.maxAngleRad, Math.min(sk.maxAngleRad, this.state.skirtAngle + this.state.skirtVel * dt));
    } else {
      this.state.skirtAngle *= Math.exp(-dt * 10.0);
      this.state.skirtVel = 0;
    }

    // 4b. Front Sleeves Spring (Student L/R sleeve, Highcer "L F arm " & R sleeve: แกว่งเล็กน้อย)
    if (outfitPhys.sleeve && outfitPhys.sleeve.enabled) {
      const sl = outfitPhys.sleeve;
      const targetSleeve = bodyDrive * sl.driveScale + Math.sin(phase - 0.65) * sl.breathWaveAmp;
      const accSleeve = (targetSleeve - this.state.sleeveAngle) * sl.stiffness - this.state.sleeveVel * sl.damping;
      this.state.sleeveVel += accSleeve * dt;
      this.state.sleeveAngle = Math.max(-sl.maxAngleRad, Math.min(sl.maxAngleRad, this.state.sleeveAngle + this.state.sleeveVel * dt));
    } else {
      this.state.sleeveAngle *= Math.exp(-dt * 10.0);
      this.state.sleeveVel = 0;
    }

    // 4c. Back Sleeves Spring (Student L/R back sleeve: แกว่งเล็กน้อย)
    if (outfitPhys.backSleeve && outfitPhys.backSleeve.enabled) {
      const bsl = outfitPhys.backSleeve;
      const targetBSleeve = bodyDrive * bsl.driveScale + Math.sin(phase - 0.80) * bsl.breathWaveAmp;
      const accBSleeve = (targetBSleeve - this.state.backSleeveAngle) * bsl.stiffness - this.state.backSleeveVel * bsl.damping;
      this.state.backSleeveVel += accBSleeve * dt;
      this.state.backSleeveAngle = Math.max(-bsl.maxAngleRad, Math.min(bsl.maxAngleRad, this.state.backSleeveAngle + this.state.backSleeveVel * dt));
    } else {
      this.state.backSleeveAngle *= Math.exp(-dt * 10.0);
      this.state.backSleeveVel = 0;
    }

    // 4d. Backcollar Spring (Student Backcollar: แกว่งน้อยมาก)
    if (outfitPhys.backcollar && outfitPhys.backcollar.enabled) {
      const col = outfitPhys.backcollar;
      const targetCollar = headDrive * col.driveScale + Math.sin(phase - 0.45) * col.breathWaveAmp;
      const accCollar = (targetCollar - this.state.collarAngle) * col.stiffness - this.state.collarVel * col.damping;
      this.state.collarVel += accCollar * dt;
      this.state.collarAngle = Math.max(-col.maxAngleRad, Math.min(col.maxAngleRad, this.state.collarAngle + this.state.collarVel * dt));
    } else {
      this.state.collarAngle *= Math.exp(-dt * 10.0);
      this.state.collarVel = 0;
    }

    // 4e. Pants Hem Spring (Highcer Lower nody Copy: ปลายขากางเกงแกว่งน้อยมาก)
    if (outfitPhys.pantsHem && outfitPhys.pantsHem.enabled) {
      const ph = outfitPhys.pantsHem;
      const targetPants = bodyDrive * ph.driveScale + Math.sin(phase - 0.90) * ph.breathWaveAmp;
      const accPants = (targetPants - this.state.pantsHemAngle) * ph.stiffness - this.state.pantsHemVel * ph.damping;
      this.state.pantsHemVel += accPants * dt;
      this.state.pantsHemAngle = Math.max(-ph.maxAngleRad, Math.min(ph.maxAngleRad, this.state.pantsHemAngle + this.state.pantsHemVel * dt));
    } else {
      this.state.pantsHemAngle *= Math.exp(-dt * 10.0);
      this.state.pantsHemVel = 0;
    }

    // Subtle eyelid crease / brow accommodation (including speaking inflection)
    const camBrowLift = (gc.camActive && gc.camFaceDetected) ? (-1.1 * camActiveScale) : 0;
    const targetBrowLift = -0.95 * breathLagWave + camBrowLift - 0.45 * Math.sin(subPhase2) - this.state.speakBrowLiftY;
    this.state.browLiftY += (targetBrowLift - this.state.browLiftY) * poseLerp;

    // ========================================================================
    // D. Natural Eye Blinking State Machine (150–250ms total, 3–6s interval)
    // ========================================================================
    const bc = this.blinkCtrl;
    const closeRatio = 0.40;
    const holdRatio  = 0.10;
    const openRatio  = 0.50;

    // Section 10: Suppress starting any new automatic blink while Head Pat is active or releasing
    if (bc.phase === 'open' && (hp.state !== 'IDLE' || this.state.patEyeClosure > 0.10)) {
      bc.nextBlinkAt = Math.max(bc.nextBlinkAt, now + 1500);
    }

    if (bc.phase === 'open') {
      this.state.blinkAmount = 0.0;
      if (now >= bc.nextBlinkAt) {
        bc.phase = 'closing';
        bc.phaseStartAt = now;
        bc.currentDurationMs = this._randRange(this.options.blinkMinDurationMs, this.options.blinkMaxDurationMs);
        if (!bc.lastWasDouble && Math.random() < this.options.doubleBlinkProb) {
          bc.pendingSecondBlink = true;
          bc.lastWasDouble = true;
          this.state.lastBlinkType = 'Double Blink';
        } else {
          bc.pendingSecondBlink = false;
          bc.lastWasDouble = false;
          this.state.lastBlinkType = 'Single Blink';
        }
      }
    } else if (bc.phase === 'closing') {
      const closeDur = bc.currentDurationMs * closeRatio;
      const t = Math.min(1.0, (now - bc.phaseStartAt) / closeDur);
      this.state.blinkAmount = t * t * (3.0 - 2.0 * t);
      if (t >= 1.0) {
        this.state.blinkAmount = 1.0;
        bc.phase = 'hold';
        bc.phaseStartAt = now;
      }
    } else if (bc.phase === 'hold') {
      const holdDur = bc.currentDurationMs * holdRatio;
      this.state.blinkAmount = 1.0;
      if (now - bc.phaseStartAt >= holdDur) {
        bc.phase = 'opening';
        bc.phaseStartAt = now;
      }
    } else if (bc.phase === 'opening') {
      const openDur = bc.currentDurationMs * openRatio;
      const t = Math.min(1.0, (now - bc.phaseStartAt) / openDur);
      const easeOut = 1.0 - Math.pow(1.0 - t, 2.2);
      this.state.blinkAmount = Math.max(0.0, 1.0 - easeOut);
      if (t >= 1.0) {
        this.state.blinkAmount = 0.0;
        this.state.blinkCount++;
        if (bc.pendingSecondBlink) {
          bc.pendingSecondBlink = false;
          bc.phase = 'double_wait';
          bc.phaseStartAt = now;
        } else {
          bc.phase = 'open';
          bc.nextBlinkAt = now + this._randRange(this.options.blinkMinIntervalMs, this.options.blinkMaxIntervalMs);
        }
      }
    } else if (bc.phase === 'double_wait') {
      this.state.blinkAmount = 0.0;
      if (now - bc.phaseStartAt >= 85) {
        bc.phase = 'closing';
        bc.phaseStartAt = now;
        bc.currentDurationMs = this._randRange(155, 200);
      }
    }

    // ========================================================================
    // E. Eye Movement & 5. Real-Time Webcam Face Tracking Gaze
    // ========================================================================
    let desiredGazeX = 0;
    let desiredGazeY = 0;

    // Subtle physiological eye fixation micro-movement (prevents dead/frozen stare)
    const microLifeX = Math.sin(now * 0.0031) * 0.32 + Math.cos(now * 0.0067) * 0.15;
    const microLifeY = Math.cos(now * 0.0024) * 0.22 + Math.sin(now * 0.0053) * 0.11;

    if (gc.camActive && gc.camFaceDetected) {
      // Track closest detected webcam face with smooth conjugate gaze
      desiredGazeX = gc.camNormX * 7.6 + microLifeX * 0.6;
      desiredGazeY = gc.camNormY * 3.4 + microLifeY * 0.6;
      this.state.gazeStateLabel = `Tracking Closest Face (${gc.camFaceCount} detected)`;
    } else {
      // Face Lost or Camera Off -> Smoothly return to Default Direct Eye Contact + occasional subtle glance
      if (gc.mode !== 'direct' && now >= gc.returnToDirectAt) {
        gc.mode = 'direct';
        gc.targetX = 0;
        gc.targetY = 0;
        this.state.gazeStateLabel = gc.camActive
          ? 'Face Lost — Returning to Center'
          : 'Direct Eye Contact (Default)';
      } else if (gc.mode === 'direct') {
        this.state.gazeStateLabel = gc.camActive
          ? 'Camera Active — Default Eye Contact'
          : 'Direct Eye Contact (Default)';
      }

      if (now >= gc.nextEventAt) {
        const r = Math.random();
        if (r < 0.62) {
          gc.mode = 'saccade';
          gc.targetX = this._randRange(-1.6, 1.6);
          gc.targetY = this._randRange(-0.9, 0.9);
          this.state.gazeStateLabel = 'Eye Contact (Subtle Fixation Shift)';
          gc.returnToDirectAt = now + this._randRange(450, 950);
          gc.nextEventAt = now + this._randRange(2500, 4400);
        } else {
          this.triggerGlance();
        }
      }

      const cursorAge = now - gc.lastCursorMoveAt;
      const cursorWeight = (!gc.camActive && this.options.enableCursorGaze && cursorAge < 2400)
        ? Math.max(0, 1.0 - cursorAge / 2400) * 0.42
        : 0;

      desiredGazeX = gc.targetX + (gc.cursorNormX * 3.8) * cursorWeight + microLifeX;
      desiredGazeY = gc.targetY + (gc.cursorNormY * 2.0) * cursorWeight + microLifeY;
    }

    // Blend in Shy Gaze Aversion during Character Interaction Animation (หลบสายตาเขินอาย)
    if (this.state.reactGazeWeight > 0.005) {
      const gw = Math.max(0, Math.min(1, this.state.reactGazeWeight));
      const shyMicroX = Math.sin(now * 0.0085) * 0.35;
      const shyMicroY = Math.cos(now * 0.0072) * 0.20;
      const shyX = ic.shyTargetX + shyMicroX;
      const shyY = ic.shyTargetY + shyMicroY;
      desiredGazeX = desiredGazeX * (1.0 - gw) + shyX * gw;
      desiredGazeY = desiredGazeY * (1.0 - gw) + shyY * gw;
      if (gw > 0.15) {
        this.state.gazeStateLabel = 'Shy Gaze Aversion (หลบสายตาเขินอาย)';
      }
    }

    // Pause Webcam / Cursor Eye Tracking during Head Pat Interaction (settles to calm downward/centered gaze)
    if (this.state.patGazePauseWeight > 0.005) {
      const pw = Math.max(0, Math.min(1, this.state.patGazePauseWeight));
      const patCalmX = hp.patNormX * 1.3;
      const patCalmY = 1.2;
      desiredGazeX = desiredGazeX * (1.0 - pw) + patCalmX * pw;
      desiredGazeY = desiredGazeY * (1.0 - pw) + patCalmY * pw;
      if (pw > 0.25) {
        this.state.gazeStateLabel = gc.camActive
          ? 'Head Pat — Webcam Gaze Paused'
          : 'Head Pat — Calm Relaxed Gaze';
      }
    }

    // Strict anatomical clamping so eyeballs never leave eye sockets or distort
    const clampedX = Math.max(-7.8, Math.min(7.8, desiredGazeX));
    const clampedY = Math.max(-3.5, Math.min(3.5, desiredGazeY));

    // Smooth Damped Interpolation (responsive during shy glance, gentle on return)
    const baseLerpSpeed = (gc.camActive && gc.camFaceDetected) ? 10.5 : 6.8;
    const lerpSpeed = this.state.reactGazeWeight > 0.1 ? 12.0 : baseLerpSpeed;
    const gazeLerp = 1.0 - Math.exp(-dt * lerpSpeed);
    this.state.gazeX += (clampedX - this.state.gazeX) * gazeLerp;
    this.state.gazeY += (clampedY - this.state.gazeY) * gazeLerp;
  }

  _renderEyeBuffer(eyeCtx, bufferW, bufferH, keys, blink, gazeX, gazeY) {
    const parts = this.manifest.parts;
    const mSc = parts[keys.sclera];
    const mLo = parts[keys.lower];
    const mIr = parts[keys.iris];
    const mSu = parts[keys.sup];
    const mUp = parts[keys.upper];
    const mCr = parts[keys.crease];

    const imSc = this.images[keys.sclera];
    const imLo = this.images[keys.lower];
    const imIr = this.images[keys.iris];
    const imSu = this.images[keys.sup];
    const imUp = this.images[keys.upper];
    const imCr = this.images[keys.crease];

    const ox = Math.min(mSc.x, mUp.x, mLo.x, mSu.x) - 16;
    const oy = Math.min(mSc.y, mUp.y, mCr.y) - 16;

    eyeCtx.clearRect(0, 0, bufferW, bufferH);
    eyeCtx.save();

    // Eyelid vertical gaze accommodation (upper & lower lids subtly follow vertical eye gaze)
    const lidGazeFollowY = gazeY * 0.22 * (1.0 - blink);
    const loDy = -3.0 * blink + lidGazeFollowY * 0.55;
    const dyProf = mUp.dyProfile;
    const yCent  = mUp.yCenterProfile;
    const upW = mUp.w;

    if (blink < 0.95) {
      eyeCtx.globalCompositeOperation = 'source-over';
      eyeCtx.drawImage(imSc, mSc.x - ox, mSc.y - oy + loDy * 0.4, mSc.w, mSc.h);

      // Clip iris strictly inside sclera alpha at exact 1:1 original dimensions (no eye shape/color distortion)
      eyeCtx.globalCompositeOperation = 'source-atop';
      const irX = (mIr.x - ox) + gazeX;
      const irY = (mIr.y - oy) + gazeY + 11.0 * blink;
      eyeCtx.drawImage(imIr, irX, irY, mIr.w, mIr.h);

      if (blink > 0.002 || Math.abs(lidGazeFollowY) > 0.05) {
        eyeCtx.globalCompositeOperation = 'destination-in';
        eyeCtx.beginPath();
        const upLocalX = mUp.x - ox;
        const upLocalY = mUp.y - oy + lidGazeFollowY;
        const firstY = upLocalY + yCent[0] + dyProf[0] * blink;
        eyeCtx.moveTo(0, firstY);
        for (let ux = 0; ux < upW; ux++) {
          const cutY = upLocalY + yCent[ux] + dyProf[ux] * blink;
          eyeCtx.lineTo(upLocalX + ux, cutY);
        }
        const lastY = upLocalY + yCent[upW - 1] + dyProf[upW - 1] * blink;
        eyeCtx.lineTo(bufferW, lastY);
        eyeCtx.lineTo(bufferW, bufferH);
        eyeCtx.lineTo(0, bufferH);
        eyeCtx.closePath();
        eyeCtx.fill();
      }
    }

    eyeCtx.globalCompositeOperation = 'source-over';
    if (blink <= 0.002) {
      eyeCtx.drawImage(imLo, mLo.x - ox, mLo.y - oy + loDy, mLo.w, mLo.h);
    } else {
      const sCtx = this.lashScratchCtx;
      sCtx.clearRect(0, 0, bufferW, bufferH);
      sCtx.globalCompositeOperation = 'source-over';
      const loAlpha = blink > 0.6 ? Math.max(0.0, 1.0 - 0.65 * ((blink - 0.6) / 0.4)) : 1.0;
      sCtx.globalAlpha = loAlpha;
      sCtx.drawImage(imLo, mLo.x - ox, mLo.y - oy + loDy, mLo.w, mLo.h);
      sCtx.globalAlpha = 1.0;

      sCtx.globalCompositeOperation = 'destination-in';
      sCtx.beginPath();
      const upLocalX = mUp.x - ox;
      const upLocalY = mUp.y - oy + lidGazeFollowY;
      sCtx.moveTo(0, upLocalY + yCent[0] + dyProf[0] * blink);
      for (let ux = 0; ux < upW; ux++) {
        sCtx.lineTo(upLocalX + ux, upLocalY + yCent[ux] + dyProf[ux] * blink);
      }
      sCtx.lineTo(bufferW, upLocalY + yCent[upW - 1] + dyProf[upW - 1] * blink);
      sCtx.lineTo(bufferW, bufferH);
      sCtx.lineTo(0, bufferH);
      sCtx.closePath();
      sCtx.fill();

      eyeCtx.drawImage(this.lashScratch, 0, 0);
    }

    const supMidX = (mSu.x + mSu.w * 0.5) - mUp.x;
    const supUx = Math.max(0, Math.min(upW - 1, Math.round(supMidX)));
    const supDy = dyProf[supUx] * blink + lidGazeFollowY;
    eyeCtx.drawImage(imSu, mSu.x - ox, mSu.y - oy + supDy, mSu.w, mSu.h);

    const upLocalX = mUp.x - ox;
    const upLocalY = mUp.y - oy + lidGazeFollowY;
    if (blink <= 0.002) {
      eyeCtx.drawImage(imUp, upLocalX, upLocalY, mUp.w, mUp.h);
    } else {
      for (let ux = 0; ux < upW; ux++) {
        const dy = dyProf[ux] * blink;
        eyeCtx.drawImage(imUp, ux, 0, 1, mUp.h, upLocalX + ux, upLocalY + dy, 1, mUp.h);
      }
    }

    // Eyelid crease / brow fold moves smoothly with blink & subtle gaze accommodation
    const meanDrop = 26.0 * blink * 0.42 + (this.state.browLiftY || 0) * (1.0 - blink) + lidGazeFollowY * 0.45;
    eyeCtx.drawImage(imCr, mCr.x - ox, mCr.y - oy + meanDrop, mCr.w, mCr.h);

    eyeCtx.restore();
    return { ox, oy };
  }

  _drawPart(key, dx = 0, dy = 0, alpha = 1.0) {
    const p = this.manifest.parts[key];
    const im = this.images[key];
    if (!p || !im) return;

    const ov = this.layerOverrides && this.layerOverrides[key];
    if (ov && !ov.visible) return;
    const finalAlpha = Math.max(0, Math.min(1, alpha * (ov ? ov.opacity : 1.0)));
    if (finalAlpha <= 0.001) return;

    const ox = dx + (ov ? ov.dx : 0);
    const oy = dy + (ov ? ov.dy : 0);
    const blend = p.blendMode && p.blendMode !== 'source-over' ? p.blendMode : null;

    const ctx = this.ctx;
    if (finalAlpha < 0.999 || blend) {
      ctx.save();
      if (finalAlpha < 0.999) ctx.globalAlpha *= finalAlpha;
      if (blend) ctx.globalCompositeOperation = blend;
      ctx.drawImage(im, p.x + ox, p.y + oy, p.w, p.h);
      ctx.restore();
    } else {
      ctx.drawImage(im, p.x + ox, p.y + oy, p.w, p.h);
    }
  }

  _withPivot(pivotXY, tx, ty, rotRad, sx, sy, fn) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(pivotXY[0] + tx, pivotXY[1] + ty);
    if (rotRad !== 0) ctx.rotate(rotRad);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.translate(-pivotXY[0], -pivotXY[1]);
    fn();
    ctx.restore();
  }

  render() {
    if (!this.isReady) return;
    const ctx = this.ctx;
    const piv = this.manifest.pivots;
    const st = this.state;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();

    if (this.options.zoomMode === 'face') {
      ctx.translate(this.width * 0.5, this.height * 0.25);
      ctx.scale(2.35, 2.35);
      ctx.translate(-this.width * 0.5, -this.height * 0.23);
    } else if (this.options.zoomMode === 'bust') {
      ctx.translate(this.width * 0.5, this.height * 0.35);
      ctx.scale(1.55, 1.55);
      ctx.translate(-this.width * 0.5, -this.height * 0.33);
    }

    const breathLag = st.breathLag;
    const elapsedSec = st.uptimeSec || ((performance.now() - this.startTime) / 1000);
    const clamp = (v, minV, maxV) => Math.max(minV, Math.min(maxV, v));
    const kin = this._getRigKinematics();
    const {
      bodySwayX,
      torsoRotRad,
      lowerRotRad,
      headTiltRad,
      waistDx,
      waistDy
    } = kin;
    const relHeadRad = headTiltRad - torsoRotRad;

    // Pose blend weights: thinkingPoseAlpha (0 = POSE_NORMAL VoraE1.psd, 1 = POSE_THINKING Vora.psd)
    const thinkingPoseAlpha = Math.max(0, Math.min(1, st.thinkingBlend || 0));
    const normalPoseAlpha   = 1.0 - thinkingPoseAlpha;

    // POSE_NORMAL: Dynamic natural arm swing pivoted inside the sleeve cuff ([195, 712] & [510, 728])
    // while l_sleeve & r_sleeve stay 100% locked to upper_body so the shoulder seam NEVER opens!
    const normalSwingL = clamp(((st.shoulderRollDeg || 0) * 0.26 + (st.lUpperArmDeg || 0) * 0.22) * (Math.PI / 180), -0.014, 0.014);
    const normalSwingR = clamp((-(st.shoulderRollDeg || 0) * 0.26 + (st.rUpperArmDeg || 0) * 0.22) * (Math.PI / 180), -0.014, 0.014);

    // POSE_THINKING: Subtle hand-on-chin flex pivoted at the left elbow [195, 745]
    // while l_upper_arm, r_forearm, r_upper_arm stay 100% locked to upper_body so shoulders & elbows NEVER split!
    const chinFlexRad = clamp((-(st.lChinForearmDeg || 0) * 0.08 + relHeadRad * (180 / Math.PI) * 0.12) * (Math.PI / 180), -0.0065, 0.0075);

    const baseBlink = Math.max(st.blinkAmount, st.patEyeClosure || 0);
    const effectiveBlink = Math.min(1.0, baseBlink + (st.reactShyLidDrop || 0) * (1.0 - baseBlink));

    // Hair Spring-Damper + Head Pat secondary hair lag (root-locked so hair never separates from Headband/Middle hair)
    const patTailRad = ((st.patHairTailOffsetDeg || 0) * 0.38 * Math.PI) / 180;
    const patBangRad = ((st.patHairBangOffsetDeg || 0) * 0.32 * Math.PI) / 180;
    const bhCfg = this.getBackHairConfig();
    const bhPhys = (bhCfg && bhCfg.physics) ? bhCfg.physics : {
      renderScale: 0.55,
      patFollowScale: 0.45,
      flutterAmp: 0.0020,
      flutterFreq: 2.2,
      maxAngleRad: 0.014
    };
    const bhPartKey = (bhCfg && bhCfg.partKey && this.hasLayer(bhCfg.partKey))
      ? bhCfg.partKey
      : ((bhCfg && bhCfg.fallbackPartKey && this.hasLayer(bhCfg.fallbackPartKey)) ? bhCfg.fallbackPartKey : 'back_hair');
    const bhHeadFollow = (bhCfg && bhCfg.headFollowRatio !== undefined) ? bhCfg.headFollowRatio : 0.68;
    const bhRenderMax = Math.min(0.014, bhPhys.maxAngleRad * 0.45);
    const backHairRot = clamp(
      st.hairBackAngle * bhPhys.renderScale +
      patTailRad * bhPhys.patFollowScale +
      Math.sin(elapsedSec * bhPhys.flutterFreq - 1.2) * bhPhys.flutterAmp,
      -bhRenderMax,
      bhRenderMax
    );
    const tailHairRotL = clamp(st.hairTailAngle * 0.45 + breathLag * 0.0022 + patTailRad, -0.013, 0.013);
    const tailHairRotR = clamp(st.hairTailAngle * 0.43 - breathLag * 0.0022 + patTailRad, -0.013, 0.013);
    const frontBangRot = clamp(st.hairFrontAngle * 0.40 + patBangRad, -0.0075, 0.0075);

    const outfitCfg = this.getOutfitConfig();
    const outfitParts = (outfitCfg && outfitCfg.parts) ? outfitCfg.parts : {};
    const useLegacyOutfit = Boolean(outfitCfg && outfitCfg.useLegacyRigRender);

    const waistPivot = [365.0, 945.0];
    const feetPivot  = [365.0, 1612.0];

    // 1. Slot "BackHair" [Drawn behind all character layers] (Anchored to exact Torso->Neck hierarchy)
    this._withPivot(
      waistPivot,
      waistDx,
      waistDy,
      torsoRotRad,
      1.0,
      1.0,
      () => {
        this._withPivot(
          piv.head,
          0,
          0,
          relHeadRad * bhHeadFollow + backHairRot,
          1.0,
          1.0,
          () => this._drawPart(bhPartKey)
        );
      }
    );

    // 2. Lower Body / Legs / Skirt (Slot "Outfit")
    if (useLegacyOutfit) {
      if (this.hasLayer('hip') && this.hasLayer('leg_l') && this.hasLayer('leg_r')) {
        const stanceMicroSway = Math.sin(elapsedSec * 1.5) * 0.0032;
        const rotL = lowerRotRad + stanceMicroSway;
        const rotR = lowerRotRad - stanceMicroSway;
        const rotHip = lowerRotRad;

        this._withPivot(
          feetPivot,
          bodySwayX * 0.65,
          waistDy,
          rotR,
          1.0,
          1.0,
          () => this._drawPart('leg_r')
        );
        this._withPivot(
          feetPivot,
          bodySwayX * 0.65,
          waistDy,
          rotL,
          1.0,
          1.0,
          () => this._drawPart('leg_l')
        );
        this._withPivot(
          feetPivot,
          bodySwayX * 0.65,
          waistDy,
          rotHip,
          1.0,
          1.0,
          () => this._drawPart('hip')
        );
      } else {
        this._withPivot(
          feetPivot,
          bodySwayX * 0.65,
          waistDy,
          lowerRotRad,
          1.0,
          1.0,
          () => this._drawPart('lower_body')
        );
      }
    } else if (outfitParts.l_leg && outfitParts.r_leg) {
      // Vora_Student_uni: "L lrg", "R leg" grounded at feetPivot
      const stanceMicroSway = Math.sin(elapsedSec * 1.5) * 0.0024;
      const rotL = lowerRotRad + stanceMicroSway;
      const rotR = lowerRotRad - stanceMicroSway;
      this._withPivot(
        feetPivot,
        bodySwayX * 0.65,
        waistDy,
        rotL,
        1.0,
        1.0,
        () => this._drawPart(outfitParts.l_leg.key)
      );
      this._withPivot(
        feetPivot,
        bodySwayX * 0.65,
        waistDy,
        rotR,
        1.0,
        1.0,
        () => this._drawPart(outfitParts.r_leg.key)
      );
    } else if (outfitParts.lower_body) {
      // Vora_Highcer_uni: "Lower nody Copy" (สะโพก+ขาสองข้างเป็นชิ้นเดียว ผูกกับสะโพก พร้อม physics ปลายขากางเกงน้อยมาก)
      const pantsHemRot = st.pantsHemAngle || 0;
      this._withPivot(
        feetPivot,
        bodySwayX * 0.65,
        waistDy,
        lowerRotRad + pantsHemRot * 0.35,
        1.0,
        1.0,
        () => this._drawPart(outfitParts.lower_body.key)
      );
    }

    // 3–8. Unified Parent-Child Torso & Head Hierarchy (Anchored at Waist [365, 945])
    // Guaranteeing 0.00px separation at Waist, Shoulders, Sleeves, Elbows, Collar, and Neck!
    this._withPivot(
      waistPivot,
      waistDx,
      waistDy,
      torsoRotRad,
      1.0,
      1.0,
      () => {
        if (useLegacyOutfit) {
          // Legacy Vora_Default rendering
          if (normalPoseAlpha > 0.002) {
            this._withPivot(
              [195.0, 712.0],
              0,
              0,
              normalSwingL,
              1.0,
              1.0,
              () => this._drawPart('l_arm_skin_full', 0, 0, normalPoseAlpha)
            );
            this._withPivot(
              [510.0, 728.0],
              0,
              0,
              normalSwingR,
              1.0,
              1.0,
              () => this._drawPart('r_arm_skin_full', 0, 0, normalPoseAlpha)
            );
          }

          this._drawPart('upper_body');

          if (normalPoseAlpha > 0.002) {
            this._drawPart('l_sleeve', 0, 0, normalPoseAlpha);
            this._drawPart('r_sleeve', 0, 0, normalPoseAlpha);
          }

          if (thinkingPoseAlpha > 0.002) {
            this._drawPart('l_upper_arm', 0, 0, thinkingPoseAlpha);
            this._drawPart('r_forearm', 0, 0, thinkingPoseAlpha);
            this._drawPart('r_upper_arm', 0, 0, thinkingPoseAlpha);
          }

          this._withPivot(
            piv.neck,
            0,
            0,
            relHeadRad * 0.25,
            1.0,
            1.0,
            () => this._drawPart('neck')
          );
        } else {
          // ==================================================================
          // Slot-based Outfit & Shared Arms Rendering (Exact PSD Z-Order)
          // ==================================================================
          const armSlot = VORA_SLOT_CONFIG.arms;
          const downParts = armSlot.poses.down.parts;
          const thinkParts = armSlot.poses.think.parts;
          const sleeveRot = st.sleeveAngle || 0;
          const backSleeveRot = st.backSleeveAngle || 0;
          const collarRot = st.collarAngle || 0;
          const skirtRot = st.skirtAngle || 0;

          // 3a. ท่า down (ปล่อยแขน): "L arm", "R arm", "Lhand", "R hand" วาดอยู่หลังสุดของแขน/ลำตัวตาม PSD
          if (normalPoseAlpha > 0.002) {
            this._withPivot(
              downParts.l_arm.pivot,
              0,
              0,
              normalSwingL,
              1.0,
              1.0,
              () => {
                this._drawPart(downParts.l_arm.key, 0, 0, normalPoseAlpha);
                this._drawPart(downParts.l_hand.key, 0, 0, normalPoseAlpha);
              }
            );
            this._withPivot(
              downParts.r_arm.pivot,
              0,
              0,
              normalSwingR,
              1.0,
              1.0,
              () => {
                this._drawPart(downParts.r_arm.key, 0, 0, normalPoseAlpha);
                this._drawPart(downParts.r_hand.key, 0, 0, normalPoseAlpha);
              }
            );
          }

          // 3b. Back Sleeves ("L back sleeve", "R Back sleeve") — วาดอยู่หลังต้นแขน ("L upper arm", "R upper arm")
          if (outfitParts.l_back_sleeve) {
            this._withPivot(
              outfitParts.l_back_sleeve.pivot || [485.0, 735.0],
              0,
              0,
              -backSleeveRot,
              1.0,
              1.0,
              () => this._drawPart(outfitParts.l_back_sleeve.key)
            );
          }
          if (outfitParts.r_back_sleeve) {
            this._withPivot(
              outfitParts.r_back_sleeve.pivot || [195.0, 722.0],
              0,
              0,
              backSleeveRot,
              1.0,
              1.0,
              () => this._drawPart(outfitParts.r_back_sleeve.key)
            );
          }

          // 3c. Shared Upper Arms ("L upper arm", "R upper arm") — ใช้ร่วมทั้งสองท่า ขยับตามลำตัว
          this._drawPart(armSlot.sharedUpperArms.right.key);
          this._drawPart(armSlot.sharedUpperArms.left.key);

          // 3d. Backcollar & Neck (ใน PSD ของ Student, Backcollar และ Neck อยู่หลังปกเสื้อ Body)
          if (outfitParts.backcollar) {
            this._withPivot(
              outfitParts.backcollar.pivot || piv.neck,
              0,
              0,
              relHeadRad * 0.12 + collarRot,
              1.0,
              1.0,
              () => this._drawPart(outfitParts.backcollar.key)
            );
          }
          if (outfitParts.neck) {
            this._withPivot(
              outfitParts.neck.pivot || piv.neck,
              0,
              0,
              relHeadRad * 0.25,
              1.0,
              1.0,
              () => this._drawPart(outfitParts.neck.key)
            );
          }

          // 3e. Skirt (Student Uni: ชายกระโปรงแกว่งตามหลังลำตัวมากที่สุด ไม่ทะลุลำตัวเพราะอยู่ใต้ชายเสื้อ Body)
          if (outfitParts.skirt) {
            const skPiv = outfitParts.skirt.pivot || [365.0, 865.0];
            this._withPivot(
              skPiv,
              0,
              0,
              skirtRot,
              1.0,
              1.0,
              () => this._drawPart(outfitParts.skirt.key)
            );
          }

          // 4a. Front Sleeves ("L sleeve" / "L F arm ", "R sleeve") — มีภาพเดียวต่อชุด ใช้กับทั้งสองท่า พร้อม physics แกว่งเล็กน้อย
          if (outfitParts.l_sleeve) {
            this._withPivot(
              outfitParts.l_sleeve.pivot || [225.0, 585.0],
              0,
              0,
              sleeveRot,
              1.0,
              1.0,
              () => this._drawPart(outfitParts.l_sleeve.key)
            );
          }
          if (outfitParts.r_sleeve) {
            this._withPivot(
              outfitParts.r_sleeve.pivot || [480.0, 585.0],
              0,
              0,
              -sleeveRot,
              1.0,
              1.0,
              () => this._drawPart(outfitParts.r_sleeve.key)
            );
          }

          // 4b. Outfit Body ("Body" / "Body ") — ขยับตามลำตัวเท่านั้น
          if (outfitParts.body) {
            this._drawPart(outfitParts.body.key);
          }

          // 5. ท่า think: "R fo arm " อยู่หน้าลำตัว (Body)
          if (thinkingPoseAlpha > 0.002) {
            this._drawPart(thinkParts.r_fo_arm.key, 0, 0, thinkingPoseAlpha);
          }
        }

        // 8. Head Group (Pivots at [365, 560] inside Torso space -> 0.00px neck joint detachment)
        this._withPivot(
          piv.head,
          0,
          0,
          relHeadRad,
          1.0,
          1.0,
          () => {
            // 8a. Middle Hair & Face/Head (Base — Untouched)
            this._drawPart('middle_hair');
            this._drawPart('head');

            // 8b. ท่า think: "Fo arm " อยู่หน้าสุดของลำตัวและคาง (Locked to Torso elbow [195, 745])
            if (thinkingPoseAlpha > 0.002) {
              const foKey = useLegacyOutfit ? 'l_forearm_chin' : VORA_SLOT_CONFIG.arms.poses.think.parts.fo_arm.key;
              ctx.save();
              ctx.translate(piv.head[0], piv.head[1]);
              if (relHeadRad !== 0) ctx.rotate(-relHeadRad);
              ctx.translate(-piv.head[0], -piv.head[1]);
              this._withPivot(
                [195.0, 745.0],
                0,
                0,
                chinFlexRad,
                1.0,
                1.0,
                () => this._drawPart(foKey, 0, 0, thinkingPoseAlpha)
              );
              ctx.restore();
            }

            // 8c. Hair Side Tails ('L tail', 'R tail') — Root-locked at y=90 with natural counter-phase air flutter
            const tailFlutterL = Math.sin(elapsedSec * 2.8) * 0.0018;
            const tailFlutterR = Math.cos(elapsedSec * 2.6) * 0.0018;
            this._withPivot(
              [219.0, 90.0],
              0,
              0,
              tailHairRotL + tailFlutterL,
              1.0,
              1.0,
              () => this._drawPart('hair_tail_l')
            );
            this._withPivot(
              [509.0, 90.0],
              0,
              0,
              tailHairRotR + tailFlutterR,
              1.0,
              1.0,
              () => this._drawPart('hair_tail_r')
            );

            // 8d. Front Hair Bangs ('H3', 'H2', 'H1') — Root-locked right on top cut edge y=83.0 with organic multi-strand micro-flutter
            const bangFlutterR = Math.sin(elapsedSec * 3.6 - 0.4) * 0.0015;
            const bangFlutterL = Math.cos(elapsedSec * 3.3 + 0.3) * 0.0016;
            const bangFlutterC = Math.sin(elapsedSec * 3.9 + 0.7) * 0.0013;
            this._withPivot(
              [445.0, 83.0],
              0,
              0,
              frontBangRot * 0.82 + bangFlutterR,
              1.0,
              1.0,
              () => this._drawPart('bang_r')
            );
            this._withPivot(
              [285.0, 83.0],
              0,
              0,
              frontBangRot * 0.85 + bangFlutterL,
              1.0,
              1.0,
              () => this._drawPart('bang_l')
            );
            this._withPivot(
              [356.0, 83.0],
              0,
              0,
              frontBangRot * 0.72 + bangFlutterC,
              1.0,
              1.0,
              () => this._drawPart('bang_c')
            );

            // 8e. Headband & Wearable Headphone Accessory
            const activeAccs = this.slotCtrl && this.slotCtrl.accessories ? this.slotCtrl.accessories : {};
            const headphoneCfg = VORA_SLOT_CONFIG.accessories && VORA_SLOT_CONFIG.accessories.headphone;
            const eyeglassesCfg = VORA_SLOT_CONFIG.accessories && VORA_SLOT_CONFIG.accessories.eyeglasses;
            const wearingHeadphone = Boolean(activeAccs.headphone && headphoneCfg && this.hasLayer(headphoneCfg.partKey));
            const wearingEyeglasses = Boolean(activeAccs.eyeglasses && eyeglassesCfg && this.hasLayer(eyeglassesCfg.partKey));

            // If wearing headphone and headphone is configured with replacesHeadband: true, hide headband to prevent overlap
            const suppressHeadband = Boolean(wearingHeadphone && headphoneCfg.replacesHeadband);
            if (!suppressHeadband && outfitCfg && outfitCfg.headband && outfitCfg.headband.enabled) {
              const hbKey = (outfitCfg.headband.key && this.hasLayer(outfitCfg.headband.key))
                ? outfitCfg.headband.key
                : 'headband';
              this._drawPart(hbKey);
            }
            if (wearingHeadphone) {
              this._drawPart(headphoneCfg.partKey);
            }

        // 8f & 8g. Single-Point Eye Controller: 'Eyesemote 1' <-> 'head pat' ('L eyelash') cross-fade
        const normalEyeOp = st.normalEyeOpacity !== undefined ? st.normalEyeOpacity : 1.0;
        const headPatEyeOp = st.headPatEyeOpacity !== undefined ? st.headPatEyeOpacity : 0.0;

        if (normalEyeOp > 0.002) {
          const posL = this._renderEyeBuffer(
            this.eyeCtxL,
            this.eyeBufferL.width,
            this.eyeBufferL.height,
            {
              sclera: 'eye_l_sclera',
              lower:  'eye_l_lower',
              iris:   'eye_l_iris',
              sup:    'eye_l_sup',
              upper:  'eye_l_upper',
              crease: 'eye_l_crease'
            },
            effectiveBlink,
            st.gazeX,
            st.gazeY
          );
          const posR = this._renderEyeBuffer(
            this.eyeCtxR,
            this.eyeBufferR.width,
            this.eyeBufferR.height,
            {
              sclera: 'eye_r_sclera',
              lower:  'eye_r_lower',
              iris:   'eye_r_iris',
              sup:    'eye_r_sup',
              upper:  'eye_r_upper',
              crease: 'eye_r_crease'
            },
            effectiveBlink,
            st.gazeX,
            st.gazeY
          );

          if (normalEyeOp < 0.999) {
            ctx.save();
            ctx.globalAlpha *= normalEyeOp;
            ctx.drawImage(this.eyeBufferL, posL.ox, posL.oy);
            ctx.drawImage(this.eyeBufferR, posR.ox, posR.oy);
            ctx.restore();
          } else {
            ctx.drawImage(this.eyeBufferL, posL.ox, posL.oy);
            ctx.drawImage(this.eyeBufferR, posR.ox, posR.oy);
          }
        }

        // 'head pat' > 'L eyelash' layer (active in POSE_NORMAL when held >= 3.0s)
        if (headPatEyeOp > 0.002 && this.hasLayer('head_pat_eyelash')) {
          this._drawPart('head_pat_eyelash', 0, 0, headPatEyeOp);
        }

        // 8h. Separated Eyebrows
        const browDy = ((st.browLiftY || 0) + (st.reactBrowLiftY || 0) + (st.patBrowDropY || 0)) * (1.0 - effectiveBlink) + 2.2 * effectiveBlink + st.gazeY * 0.15;
        this._drawPart('eye_r_brow', 0, browDy);
        this._drawPart('eye_l_brow', 0, browDy);

        // 8h-2. Wearable Eyeglasses Accessory (drawn over eyes with Multiply blend mode per PSD)
        if (wearingEyeglasses) {
          this._drawPart(eyeglassesCfg.partKey);
        }

        // 8i. Single-Point Mouth Controller: 'Smile 1' <-> 'mouth 2' (Speaking Lip-Sync) <-> 'mouth 3' (Head Pat)
        const smileOp = st.smileMouthOpacity !== undefined ? st.smileMouthOpacity : 1.0;
        const mouth2Op = st.speakMouth2Opacity !== undefined ? st.speakMouth2Opacity : 0.0;
        const mouth3Op = st.patMouth3Opacity !== undefined ? st.patMouth3Opacity : 0.0;
        if (smileOp > 0.002) {
          this._drawPart('mouth_smile', 0, 0, smileOp);
        }
        if (mouth2Op > 0.002 && this.hasLayer('mouth_2')) {
          // Pivot at upper lip center [364.0, 468.0] with natural downward jaw drop follow-through (0..1.6px)
          const jawDropY = (st.mouthOpen || 0) * 0.016;
          this._withPivot(
            [364.0, 468.0],
            0,
            jawDropY,
            0,
            st.speakMouth2ScaleX || 1.0,
            st.speakMouth2ScaleY || 1.0,
            () => this._drawPart('mouth_2', 0, 0, mouth2Op)
          );
        }
        if (mouth3Op > 0.002 && this.hasLayer('mouth_3')) {
          this._drawPart('mouth_3', 0, 0, mouth3Op);
        }

        // 8j. Debug Hitbox Overlay (follows Head Group transform around Neck Pivot)
        if (st.showDebugHitbox || this.options.showDebugPivots) {
          const hb = this.headPatCtrl.hitbox;
          ctx.save();
          ctx.strokeStyle = st.headPatActive ? '#10b981' : (st.headPatHover ? '#f59e0b' : '#e11d48');
          ctx.fillStyle = st.headPatActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(225, 29, 72, 0.08)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([8, 5]);
          ctx.beginPath();
          ctx.ellipse(hb.centerX, hb.centerY, hb.halfWidth, hb.halfHeight, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw head center cross
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hb.centerX - 12, hb.centerY);
          ctx.lineTo(hb.centerX + 12, hb.centerY);
          ctx.moveTo(hb.centerX, hb.centerY - 12);
          ctx.lineTo(hb.centerX, hb.centerY + 12);
          ctx.stroke();

          // Draw Neck Pivot marker [365, 560]
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.arc(piv.head[0], piv.head[1], 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    );
      }
    );

    ctx.restore();
    this._updateDebugPanel();
  }

  /**
   * Simulates a Head Pat interaction programmatically (useful for ?debug=1 panel & automated tests)
   */
  simulateHeadPat(durationMs = 3400, withRub = true) {
    if (this._simPatTimer) clearInterval(this._simPatTimer);
    if (this._simPatEndTimer) clearTimeout(this._simPatEndTimer);
    const hb = this.headPatCtrl.hitbox;
    const startX = hb.centerX;
    const startY = hb.centerY - 30;
    const started = this.startHeadPat(startX, startY, 999);
    if (!started) return false;

    const t0 = performance.now();
    if (withRub) {
      this._simPatTimer = setInterval(() => {
        if (!this.headPatCtrl.isDown) {
          clearInterval(this._simPatTimer);
          this._simPatTimer = null;
          return;
        }
        const elapsed = (performance.now() - t0) / 1000;
        const oscX = hb.centerX + Math.sin(elapsed * 5.2) * (hb.halfWidth * 0.55);
        this.moveHeadPat(oscX, startY);
      }, 32);
    }

    this._simPatEndTimer = setTimeout(() => {
      if (this._simPatTimer) {
        clearInterval(this._simPatTimer);
        this._simPatTimer = null;
      }
      this.endHeadPat();
    }, durationMs);
    return true;
  }

  /**
   * Initializes the Section 14 Debug Panel when ?debug=1 is present in URL (or toggled manually)
   */
  _initDebugPanel() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const debugActive = params.get('debug') === '1' || Boolean(this.options.enableDebugPanel);
    if (debugActive) {
      this.state.showDebugHitbox = true;
      this._mountDebugPanel();
    }
  }

  toggleDebugPanel(forceState) {
    if (!this._debugPanelEl) {
      this._mountDebugPanel();
    }
    const show = forceState !== undefined
      ? Boolean(forceState)
      : this._debugPanelEl.style.display === 'none';
    this._debugPanelEl.style.display = show ? 'block' : 'none';
    this.state.showDebugHitbox = show;
  }

  _mountDebugPanel() {
    if (this._debugPanelEl || typeof document === 'undefined') return;
    const panel = document.createElement('div');
    panel.id = 'voraHeadPatDebugPanel';
    panel.style.cssText = [
      'position:fixed',
      'top:70px',
      'left:16px',
      'width:325px',
      'background:rgba(15,23,42,0.92)',
      'backdrop-filter:blur(12px)',
      'border:1.5px solid rgba(225,29,72,0.65)',
      'border-radius:14px',
      'padding:12px 14px',
      'color:#f8fafc',
      'font-family:"JetBrains Mono","Prompt",monospace',
      'font-size:11.5px',
      'line-height:1.45',
      'z-index:9999',
      'box-shadow:0 14px 36px rgba(0,0,0,0.45)',
      'user-select:none'
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.12);">
        <strong style="color:#fb7185;font-size:12.5px;">🛠 VORA Head Pat Debug (?debug=1)</strong>
        <button id="dbgCloseBtn" style="background:rgba(255,255,255,0.1);border:none;color:#cbd5e1;border-radius:6px;padding:2px 7px;cursor:pointer;font-size:11px;">✕</button>
      </div>
      <div id="dbgMetricsBody" style="display:grid;grid-template-columns:115px 1fr;gap:3px 8px;margin-bottom:10px;">
        <span style="color:#94a3b8;">State:</span><strong id="dbgState" style="color:#38bdf8;">IDLE</strong>
        <span style="color:#94a3b8;">Outfit Slot:</span><strong id="dbgOutfit" style="color:#34d399;">Vora_Student_uni</strong>
        <span style="color:#94a3b8;">BackHair Slot:</span><strong id="dbgBackHair" style="color:#fbbf24;">classic</strong>
        <span style="color:#94a3b8;">Accessories:</span><strong id="dbgAccessories" style="color:#38bdf8;">None</strong>
        <span style="color:#94a3b8;">Hold Time:</span><strong id="dbgHoldTime">0.00s</strong>
        <span style="color:#94a3b8;">Current Pose:</span><strong id="dbgPose" style="color:#a78bfa;">POSE_NORMAL</strong>
        <span style="color:#94a3b8;">Thinking Lock:</span><span id="dbgThinkingLock">OFF</span>
        <span style="color:#94a3b8;">Queued Pose:</span><span id="dbgQueuedPose">-</span>
        <span style="color:#94a3b8;">Eyelid Squeeze:</span><strong id="dbgSqueeze" style="color:#facc15;">0%</strong>
        <span style="color:#94a3b8;">Active Eye:</span><span id="dbgEyeLayer">Eyesemote 1</span>
        <span style="color:#94a3b8;">Eye Opacity:</span><span id="dbgEyeOpacity">Norm 1.00 / Pat 0.00</span>
        <span style="color:#94a3b8;">Active Mouth:</span><span id="dbgMouthLayer">Smile 1</span>
        <span style="color:#94a3b8;">Mouth Opacity:</span><span id="dbgMouthOpacity">Smile 1.00 / m3 0.00</span>
        <span style="color:#94a3b8;">Head Tilt/Shift:</span><span id="dbgHeadMotion">0.00° / 0.0px</span>
        <span style="color:#94a3b8;">Body / Hair:</span><span id="dbgSecondary">0.00° / 0.00°</span>
        <span style="color:#94a3b8;">Dialogue Mode:</span><span id="dbgDialogueCfg">OFF (POSE_NORMAL)</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.12);">
        <button id="dbgBtnOutfitStudent" style="flex:1;background:#059669;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">Student</button>
        <button id="dbgBtnOutfitHighcer" style="flex:1;background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">Highcer</button>
        <button id="dbgBtnOutfitDefault" style="flex:1;background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">Original</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;padding-top:5px;">
        <button id="dbgBtnHairClassic" style="flex:1;background:#d97706;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">Hair: Classic</button>
        <button id="dbgBtnHairShort" style="flex:1;background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">Hair: Short</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;padding-top:5px;">
        <button id="dbgBtnAccGlasses" style="flex:1;background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">👓 Glasses: OFF</button>
        <button id="dbgBtnAccHeadphone" style="flex:1;background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">🎧 Headphone: OFF</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;padding-top:5px;">
        <button id="dbgBtnPoseNormal" style="flex:1;background:#be123c;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">Arm: Down</button>
        <button id="dbgBtnPoseThinking" style="flex:1;background:#334155;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;font-weight:600;">Arm: Think</button>
        <button id="dbgBtnThinkingLock" style="flex:1;background:#475569;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;">AI Think: OFF</button>
        <button id="dbgBtnSimShort" style="flex:1;background:#0284c7;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;">Sim &lt;3s (1.2s)</button>
        <button id="dbgBtnSimLong" style="flex:1;background:#059669;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;">Sim &ge;3s (3.4s)</button>
        <button id="dbgBtnHitbox" style="flex:1;background:#475569;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;">Hitbox: ON</button>
        <button id="dbgBtnToggleNormalDlg" style="flex:1;background:#475569;color:#fff;border:none;border-radius:6px;padding:5px 6px;cursor:pointer;font-size:10.5px;">Normal Dlg: OFF</button>
      </div>
    `;

    document.body.appendChild(panel);
    this._debugPanelEl = panel;
    this._dbgRefs = {
      state: panel.querySelector('#dbgState'),
      outfit: panel.querySelector('#dbgOutfit'),
      backHair: panel.querySelector('#dbgBackHair'),
      accessories: panel.querySelector('#dbgAccessories'),
      holdTime: panel.querySelector('#dbgHoldTime'),
      pose: panel.querySelector('#dbgPose'),
      thinkingLock: panel.querySelector('#dbgThinkingLock'),
      queuedPose: panel.querySelector('#dbgQueuedPose'),
      squeeze: panel.querySelector('#dbgSqueeze'),
      eyeLayer: panel.querySelector('#dbgEyeLayer'),
      eyeOpacity: panel.querySelector('#dbgEyeOpacity'),
      mouthLayer: panel.querySelector('#dbgMouthLayer'),
      mouthOpacity: panel.querySelector('#dbgMouthOpacity'),
      headMotion: panel.querySelector('#dbgHeadMotion'),
      secondary: panel.querySelector('#dbgSecondary'),
      dialogueCfg: panel.querySelector('#dbgDialogueCfg'),
      btnOutfitStudent: panel.querySelector('#dbgBtnOutfitStudent'),
      btnOutfitHighcer: panel.querySelector('#dbgBtnOutfitHighcer'),
      btnOutfitDefault: panel.querySelector('#dbgBtnOutfitDefault'),
      btnHairClassic: panel.querySelector('#dbgBtnHairClassic'),
      btnHairShort: panel.querySelector('#dbgBtnHairShort'),
      btnAccGlasses: panel.querySelector('#dbgBtnAccGlasses'),
      btnAccHeadphone: panel.querySelector('#dbgBtnAccHeadphone'),
      btnPoseNormal: panel.querySelector('#dbgBtnPoseNormal'),
      btnPoseThinking: panel.querySelector('#dbgBtnPoseThinking'),
      btnThinkingLock: panel.querySelector('#dbgBtnThinkingLock'),
      btnHitbox: panel.querySelector('#dbgBtnHitbox'),
      btnNormalDlg: panel.querySelector('#dbgBtnToggleNormalDlg')
    };

    panel.querySelector('#dbgCloseBtn').addEventListener('click', () => this.toggleDebugPanel(false));
    this._dbgRefs.btnOutfitStudent.addEventListener('click', () => this.setOutfit('Vora_Student_uni'));
    this._dbgRefs.btnOutfitHighcer.addEventListener('click', () => this.setOutfit('Vora_Highcer_uni'));
    this._dbgRefs.btnOutfitDefault.addEventListener('click', () => this.setOutfit('Vora_Default'));
    this._dbgRefs.btnHairClassic.addEventListener('click', () => this.setBackHair('classic'));
    this._dbgRefs.btnHairShort.addEventListener('click', () => this.setBackHair('short'));
    this._dbgRefs.btnAccGlasses.addEventListener('click', () => this.toggleAccessory('eyeglasses'));
    this._dbgRefs.btnAccHeadphone.addEventListener('click', () => this.toggleAccessory('headphone'));
    this._dbgRefs.btnPoseNormal.addEventListener('click', () => this.setPose('POSE_NORMAL'));
    this._dbgRefs.btnPoseThinking.addEventListener('click', () => this.setPose('POSE_THINKING'));
    this._dbgRefs.btnThinkingLock.addEventListener('click', () => {
      this.setThinkingState(!this.poseCtrl.isThinkingAnswer);
    });
    panel.querySelector('#dbgBtnSimShort').addEventListener('click', () => this.simulateHeadPat(1200, true));
    panel.querySelector('#dbgBtnSimLong').addEventListener('click', () => this.simulateHeadPat(3400, true));
    this._dbgRefs.btnHitbox.addEventListener('click', () => {
      this.state.showDebugHitbox = !this.state.showDebugHitbox;
      this._dbgRefs.btnHitbox.textContent = `Hitbox: ${this.state.showDebugHitbox ? 'ON' : 'OFF'}`;
    });
    this._dbgRefs.btnNormalDlg.addEventListener('click', () => {
      const cfg = HEAD_PAT_CONFIG.poses.POSE_NORMAL.dialogue;
      cfg.enabled = !cfg.enabled;
      this._dbgRefs.btnNormalDlg.textContent = `Normal Dlg: ${cfg.enabled ? 'ON' : 'OFF'}`;
    });
  }

  _updateDebugPanel() {
    if (!this._debugPanelEl || this._debugPanelEl.style.display === 'none' || !this._dbgRefs) return;
    const r = this._dbgRefs;
    const st = this.state;
    const pc = this.poseCtrl;
    const profile = this.getPoseProfile(pc.currentPose);

    r.state.textContent = st.animState;
    r.state.style.color = st.animState === 'IDLE'
      ? '#38bdf8'
      : (st.animState === 'HEAD_PAT_LONG' ? '#10b981' : '#f59e0b');
    if (r.outfit) r.outfit.textContent = this.slotCtrl.outfitId;
    if (r.backHair) r.backHair.textContent = this.slotCtrl.backHairId;
    if (r.accessories) {
      const activeList = st.activeAccessories && st.activeAccessories.length > 0 ? st.activeAccessories.join(', ') : 'None';
      r.accessories.textContent = activeList;
    }
    r.holdTime.textContent = `${(st.headPatDurationSec || 0).toFixed(2)}s`;
    r.pose.textContent = pc.transitioning
      ? `${pc.currentPose} → ${pc.targetPose}`
      : pc.currentPose;
    if (r.thinkingLock) {
      r.thinkingLock.textContent = pc.isThinkingAnswer ? 'ACTIVE (Locked Think)' : 'OFF (Idle Random)';
      r.thinkingLock.style.color = pc.isThinkingAnswer ? '#f43f5e' : '#94a3b8';
    }
    r.queuedPose.textContent = pc.queuedPose || '-';
    r.squeeze.textContent = `${Math.round((st.patEyeClosure || 0) * 100)}%`;
    r.eyeLayer.textContent = st.activeEyeLayerLabel || 'Eyesemote 1';
    r.eyeOpacity.textContent = `Norm ${(st.normalEyeOpacity ?? 1).toFixed(2)} / Pat ${(st.headPatEyeOpacity ?? 0).toFixed(2)}`;
    r.mouthLayer.textContent = st.activeMouthLayerLabel || 'Smile 1';
    r.mouthOpacity.textContent = `Sm ${(st.smileMouthOpacity ?? 1).toFixed(2)} / m2 ${(st.speakMouth2Opacity ?? 0).toFixed(2)} / m3 ${(st.patMouth3Opacity ?? 0).toFixed(2)}`;
    r.headMotion.textContent = `${(st.patHeadTiltDeg || 0).toFixed(2)}° / ${(st.patHeadSwayX || 0).toFixed(1)}px`;
    r.secondary.textContent = `Body ${(st.patBodyTiltDeg || 0).toFixed(2)}° / Hair ${(st.patHairTailOffsetDeg || 0).toFixed(2)}°`;
    r.dialogueCfg.textContent = `${profile.dialogue && profile.dialogue.enabled ? 'ON' : 'OFF'} (${pc.currentPose})`;

    if (r.btnOutfitStudent) r.btnOutfitStudent.style.background = this.slotCtrl.outfitId === 'Vora_Student_uni' ? '#059669' : '#334155';
    if (r.btnOutfitHighcer) r.btnOutfitHighcer.style.background = this.slotCtrl.outfitId === 'Vora_Highcer_uni' ? '#059669' : '#334155';
    if (r.btnOutfitDefault) r.btnOutfitDefault.style.background = this.slotCtrl.outfitId === 'Vora_Default' ? '#059669' : '#334155';
    if (r.btnHairClassic) r.btnHairClassic.style.background = this.slotCtrl.backHairId === 'classic' ? '#d97706' : '#334155';
    if (r.btnHairShort) r.btnHairShort.style.background = this.slotCtrl.backHairId === 'short' ? '#d97706' : '#334155';
    if (r.btnAccGlasses) {
      const gOn = Boolean(this.slotCtrl.accessories && this.slotCtrl.accessories.eyeglasses);
      r.btnAccGlasses.textContent = `👓 Glasses: ${gOn ? 'ON' : 'OFF'}`;
      r.btnAccGlasses.style.background = gOn ? '#0284c7' : '#334155';
    }
    if (r.btnAccHeadphone) {
      const hOn = Boolean(this.slotCtrl.accessories && this.slotCtrl.accessories.headphone);
      r.btnAccHeadphone.textContent = `🎧 Headphone: ${hOn ? 'ON' : 'OFF'}`;
      r.btnAccHeadphone.style.background = hOn ? '#7c3aed' : '#334155';
    }
    r.btnPoseNormal.style.background = pc.targetPose === 'POSE_NORMAL' ? '#be123c' : '#334155';
    r.btnPoseThinking.style.background = pc.targetPose === 'POSE_THINKING' ? '#be123c' : '#334155';
    if (r.btnThinkingLock) {
      r.btnThinkingLock.textContent = `AI Think: ${pc.isThinkingAnswer ? 'ON' : 'OFF'}`;
      r.btnThinkingLock.style.background = pc.isThinkingAnswer ? '#e11d48' : '#475569';
    }
  }
}

/**
 * VoraCameraFaceTracker — Real-Time Webcam Closest-Face Detector & Gaze Controller
 */
class VoraCameraFaceTracker {
  constructor(rig, options = {}) {
    this.rig = rig;
    this.options = Object.assign({
      previewCanvas: null,
      onStatusChange: null,
      detectionIntervalMs: 55,
      smoothingFactor: 0.28,
      deadzoneThreshold: 0.012
    }, options);

    this.previewCanvas = typeof this.options.previewCanvas === 'string'
      ? document.getElementById(this.options.previewCanvas)
      : this.options.previewCanvas;
    this.previewCtx = this.previewCanvas ? this.previewCanvas.getContext('2d') : null;

    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.autoplay = true;

    this.cvCanvas = document.createElement('canvas');
    this.cvCanvas.width = 160;
    this.cvCanvas.height = 120;
    this.cvCtx = this.cvCanvas.getContext('2d', { willReadFrequently: true });

    this.stream = null;
    this.isActive = false;
    this.permissionState = 'prompt';
    this.detectorType = 'Standby (Ready)';
    this.mpLandmarker = null;
    this.mpDetector = null;
    this.nativeDetector = null;
    this.detectTimer = null;
    this.previewRaf = null;

    this.lastFaces = [];
    this.closestFace = null;
    this.smoothedTarget = { x: 0, y: 0, w: 0, h: 0, area: 0 };
    this.filteredGaze = { normX: 0, normY: 0, initialized: false };
  }

  async _initDetectors() {
    if (!this.mpLandmarker && !this.mpDetector) {
      try {
        const visionModule = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const FilesetResolver = visionModule.FilesetResolver;
        const FaceLandmarker = visionModule.FaceLandmarker;
        const FaceDetector = visionModule.FaceDetector;

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        try {
          this.mpLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
              delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numFaces: 5,
            minFaceDetectionConfidence: 0.45,
            minFacePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45
          });
          this.detectorType = 'MediaPipe Face Landmarker (GPU)';
          return;
        } catch (landmarkErr) {
          this.mpDetector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
              delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.45
          });
          this.detectorType = 'MediaPipe Face Detection (GPU)';
          return;
        }
      } catch (err) {
        console.info('MediaPipe CDN unavailable or offline, falling back to local detector:', err.message);
      }
    }

    if (!this.nativeDetector && typeof window.FaceDetector === 'function') {
      try {
        const td = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
        await td.detect(this.cvCanvas);
        this.nativeDetector = td;
        this.detectorType = 'Native Browser FaceDetector';
        return;
      } catch (err) {
        console.info('Native FaceDetector not enabled, using Built-in CV Face Tracker.');
      }
    }

    this.detectorType = 'Built-in Local CV Face Tracker';
  }

  async start() {
    if (this.isActive) return true;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.permissionState = 'denied';
      this._emitStatus('error', 'เบราว์เซอร์นี้ไม่รองรับการใช้งานกล้อง Webcam (MediaDevices API) — ใช้ระบบสบตาอัตโนมัติแทน');
      return false;
    }

    this._emitStatus('connecting', 'กำลังขออนุญาตเข้าถึงกล้อง Webcam จากผู้ใช้...');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      });

      this.permissionState = 'granted';
      await this._initDetectors();

      this.video.srcObject = this.stream;
      await this.video.play();

      if (this.previewCanvas) {
        this.previewCanvas.width = 320;
        this.previewCanvas.height = 240;
      }

      this.isActive = true;
      this.filteredGaze.initialized = false;
      this._emitStatus('active', `เปิดกล้องสำเร็จ (${this.detectorType})`);
      this._startLoops();
      return true;
    } catch (err) {
      console.warn('Webcam access declined or unavailable:', err);
      this.isActive = false;
      const isDenied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError');
      const isNotFound = err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError');

      if (isDenied) {
        this.permissionState = 'denied';
        this._emitStatus('denied', 'ผู้ใช้ปฏิเสธการอนุญาตใช้กล้อง — Vora ใช้ระบบสบตาพื้นฐาน (Default Eye Contact) ตามปกติ');
      } else if (isNotFound) {
        this._emitStatus('error', 'ไม่พบอุปกรณ์กล้อง Webcam ในเครื่อง — Vora ใช้ระบบสบตาพื้นฐาน (Default Eye Contact)');
      } else {
        this._emitStatus('error', 'ไม่สามารถเปิดกล้องได้ในขณะนี้ — Vora ใช้ระบบสบตาพื้นฐาน (Default Eye Contact)');
      }
      return false;
    }
  }

  stop() {
    this.isActive = false;
    if (this.detectTimer) {
      clearTimeout(this.detectTimer);
      this.detectTimer = null;
    }
    if (this.previewRaf) {
      cancelAnimationFrame(this.previewRaf);
      this.previewRaf = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.lastFaces = [];
    this.closestFace = null;
    this.smoothedTarget = { x: 0, y: 0, w: 0, h: 0, area: 0 };
    this.filteredGaze.initialized = false;

    if (this.rig) {
      this.rig.setCameraFaceTarget({
        cameraActive: false,
        detected: false,
        normX: 0,
        normY: 0,
        area: 0,
        count: 0
      });
    }
    if (this.previewCtx && this.previewCanvas) {
      this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }
    this._emitStatus('stopped', 'ปิดกล้อง Webcam แล้ว — Vora ใช้ระบบสบตาพื้นฐาน (Default Eye Contact)');
  }

  toggle() {
    if (this.isActive) {
      this.stop();
      return Promise.resolve(false);
    }
    return this.start();
  }

  _emitStatus(state, message) {
    if (typeof this.options.onStatusChange === 'function') {
      this.options.onStatusChange({
        state,
        message,
        isActive: this.isActive,
        permissionState: this.permissionState,
        detectorType: this.detectorType,
        faceCount: this.lastFaces.length,
        closestFace: this.closestFace
      });
    }
  }

  _startLoops() {
    const runDetection = async () => {
      if (!this.isActive) return;
      if (!document.hidden && this.video.readyState >= 2 && this.video.videoWidth > 0) {
        await this._detectFacesFrame();
      }
      if (this.isActive) {
        this.detectTimer = setTimeout(runDetection, this.options.detectionIntervalMs);
      }
    };
    runDetection();

    const renderPreviewLoop = () => {
      if (!this.isActive) return;
      if (!document.hidden) {
        this._renderPreviewHud();
      }
      this.previewRaf = requestAnimationFrame(renderPreviewLoop);
    };
    renderPreviewLoop();
  }

  async _detectFacesFrame() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;

    let rawFaces = [];
    const nowMs = performance.now();

    if (this.mpLandmarker) {
      try {
        const res = this.mpLandmarker.detectForVideo(this.video, nowMs);
        if (res && Array.isArray(res.faceLandmarks) && res.faceLandmarks.length > 0) {
          rawFaces = res.faceLandmarks.map((landmarks) => {
            let minX = 1, maxX = 0, minY = 1, maxY = 0;
            for (let i = 0; i < landmarks.length; i++) {
              const pt = landmarks[i];
              if (pt.x < minX) minX = pt.x;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.y > maxY) maxY = pt.y;
            }
            const nw = Math.max(0.01, maxX - minX);
            const nh = Math.max(0.01, maxY - minY);
            const nx = 1.0 - maxX;
            const ny = minY;

            let eyeX = nx + nw * 0.5;
            let eyeY = ny + nh * 0.40;
            if (landmarks[168]) {
              eyeX = 1.0 - landmarks[168].x;
              eyeY = landmarks[168].y;
            }
            return { x: nx, y: ny, w: nw, h: nh, area: nw * nh, eyeX, eyeY };
          });
        }
      } catch (e) {}
    } else if (this.mpDetector) {
      try {
        const res = this.mpDetector.detectForVideo(this.video, nowMs);
        if (res && Array.isArray(res.detections)) {
          rawFaces = res.detections.map((d) => {
            const bb = d.boundingBox;
            const nw = bb.width / vw;
            const nh = bb.height / vh;
            const nx = 1.0 - ((bb.originX + bb.width) / vw);
            const ny = bb.originY / vh;

            let eyeX = nx + nw * 0.5;
            let eyeY = ny + nh * 0.42;
            if (d.keypoints && d.keypoints.length >= 2) {
              const kp0 = d.keypoints[0];
              const kp1 = d.keypoints[1];
              eyeX = 1.0 - ((kp0.x + kp1.x) * 0.5);
              eyeY = (kp0.y + kp1.y) * 0.5;
            }
            return { x: nx, y: ny, w: nw, h: nh, area: nw * nh, eyeX, eyeY };
          });
        }
      } catch (e) {}
    } else if (this.nativeDetector) {
      try {
        const detections = await this.nativeDetector.detect(this.video);
        rawFaces = detections.map((d) => {
          const bb = d.boundingBox;
          const nw = bb.width / vw;
          const nh = bb.height / vh;
          const nx = 1.0 - ((bb.x + bb.width) / vw);
          const ny = bb.y / vh;
          return {
            x: nx,
            y: ny,
            w: nw,
            h: nh,
            area: nw * nh,
            eyeX: nx + nw * 0.5,
            eyeY: ny + nh * 0.42
          };
        });
      } catch (e) {}
    } else {
      rawFaces = this._detectFacesBuiltInCV();
    }

    const validFaces = rawFaces.filter(f => f.area >= 0.008);
    validFaces.sort((a, b) => b.area - a.area);
    this.lastFaces = validFaces;

    if (validFaces.length > 0) {
      const closest = validFaces[0];
      this.closestFace = closest;

      const rawNormX = Math.max(-1, Math.min(1, (closest.eyeX - 0.5) * 2.2));
      const rawNormY = Math.max(-1, Math.min(1, (closest.eyeY - 0.48) * 2.2));

      const fg = this.filteredGaze;
      if (!fg.initialized) {
        fg.normX = rawNormX;
        fg.normY = rawNormY;
        fg.initialized = true;
      } else {
        const dx = rawNormX - fg.normX;
        const dy = rawNormY - fg.normY;
        const alpha = this.options.smoothingFactor;
        if (Math.abs(dx) > this.options.deadzoneThreshold) {
          fg.normX += dx * alpha;
        } else {
          fg.normX += dx * (alpha * 0.35);
        }
        if (Math.abs(dy) > this.options.deadzoneThreshold) {
          fg.normY += dy * alpha;
        } else {
          fg.normY += dy * (alpha * 0.35);
        }
      }

      this.rig.setCameraFaceTarget({
        cameraActive: true,
        detected: true,
        normX: fg.normX,
        normY: fg.normY,
        area: closest.area,
        count: validFaces.length
      });
      this._emitStatus('tracking', `กำลังสบตากับใบหน้าที่ใกล้ที่สุด (พบ ${validFaces.length} ใบหน้า)`);
    } else {
      this.closestFace = null;
      this.rig.setCameraFaceTarget({
        cameraActive: true,
        detected: false,
        normX: 0,
        normY: 0,
        area: 0,
        count: 0
      });
      this._emitStatus('searching', 'ไม่พบใบหน้าหน้ากล้อง — ดวงตากำลังมองตรงตามปกติ');
    }
  }

  _detectFacesBuiltInCV() {
    const w = this.cvCanvas.width;
    const h = this.cvCanvas.height;
    this.cvCtx.save();
    this.cvCtx.scale(-1, 1);
    this.cvCtx.drawImage(this.video, -w, 0, w, h);
    this.cvCtx.restore();

    const imgData = this.cvCtx.getImageData(0, 0, w, h).data;
    const gridW = 40;
    const gridH = 30;
    const mask = new Uint8Array(gridW * gridH);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const px = gx * 4 + 2;
        const py = gy * 4 + 2;
        const idx = (py * w + px) * 4;
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];

        const y  =  0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

        if (y > 45 && y < 240 && cr > 131 && cr < 178 && cb > 75 && cb < 132) {
          mask[gy * gridW + gx] = 1;
        }
      }
    }

    const visited = new Uint8Array(gridW * gridH);
    const blobs = [];

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const startIdx = gy * gridW + gx;
        if (!mask[startIdx] || visited[startIdx]) continue;

        const queue = [startIdx];
        visited[startIdx] = 1;
        let minX = gx, maxX = gx, minY = gy, maxY = gy;
        let sumX = 0, sumY = 0, count = 0;

        while (queue.length > 0) {
          const curr = queue.pop();
          const cy = Math.floor(curr / gridW);
          const cx = curr % gridW;
          count++;
          sumX += cx;
          sumY += cy;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const neighbors = [
            cy > 0 ? (cy - 1) * gridW + cx : -1,
            cy < gridH - 1 ? (cy + 1) * gridW + cx : -1,
            cx > 0 ? cy * gridW + (cx - 1) : -1,
            cx < gridW - 1 ? cy * gridW + (cx + 1) : -1
          ];
          for (let n of neighbors) {
            if (n >= 0 && mask[n] && !visited[n]) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }

        if (count >= 14) {
          const bw = (maxX - minX + 1) / gridW;
          const bh = (maxY - minY + 1) / gridH;
          const aspect = bh / Math.max(0.05, bw);
          if (aspect > 0.6 && aspect < 2.6) {
            const nx = minX / gridW;
            const ny = minY / gridH;
            const cx = (sumX / count) / gridW;
            const cy = (sumY / count) / gridH;
            blobs.push({
              x: nx,
              y: ny,
              w: bw,
              h: bh,
              area: bw * bh,
              eyeX: cx,
              eyeY: ny + bh * 0.4
            });
          }
        }
      }
    }

    return blobs;
  }

  _renderPreviewHud() {
    if (!this.previewCtx || !this.previewCanvas || !this.isActive) return;
    const ctx = this.previewCtx;
    const cw = this.previewCanvas.width;
    const ch = this.previewCanvas.height;

    ctx.clearRect(0, 0, cw, ch);

    if (this.video.readyState >= 2) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, -cw, 0, cw, ch);
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(6, 12, 24, 0.18)';
    ctx.fillRect(0, 0, cw, ch);

    for (let i = this.lastFaces.length - 1; i >= 0; i--) {
      const f = this.lastFaces[i];
      const isClosest = (i === 0);
      const bx = f.x * cw;
      const by = f.y * ch;
      const bw = f.w * cw;
      const bh = f.h * ch;

      if (isClosest) {
        const s = this.smoothedTarget;
        if (s.w === 0) {
          s.x = bx; s.y = by; s.w = bw; s.h = bh;
        } else {
          s.x += (bx - s.x) * 0.32;
          s.y += (by - s.y) * 0.32;
          s.w += (bw - s.w) * 0.32;
          s.h += (bh - s.h) * 0.32;
        }

        ctx.save();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 10;
        ctx.strokeRect(s.x, s.y, s.w, s.h);

        const ex = f.eyeX * cw;
        const ey = f.eyeY * ch;
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(ex - 10, ey);
        ctx.lineTo(ex + 10, ey);
        ctx.moveTo(ex, ey - 10);
        ctx.lineTo(ex, ey + 10);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const proxPct = Math.min(99, Math.round(Math.sqrt(f.area) * 180));
        ctx.fillStyle = 'rgba(6, 14, 28, 0.85)';
        ctx.fillRect(s.x, Math.max(0, s.y - 20), Math.min(cw - s.x, 155), 18);
        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillText(`CLOSEST USER (${proxPct}%)`, s.x + 5, Math.max(12, s.y - 7));
        ctx.restore();
      } else {
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.2;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.restore();
      }
    }
  }
}

window.VoraLiveRig = VoraLiveRig;
window.VoraCameraFaceTracker = VoraCameraFaceTracker;
