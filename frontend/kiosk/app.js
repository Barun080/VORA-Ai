// VORA Kiosk — ตัวประสานงานหน้าจอหุ่นยนต์ (Interaction Orchestrator) · ธีม BLACK × YELLOW
// ใช้ระบบเดิมทั้งหมด: /api/chat (AI จริง), voice.js (Web Speech API / edge-tts), shared/vision.js (MediaPipe),
// WebSocket /ws (robot.status, announce, say), /api/robot/stop (หยุดฉุกเฉิน), QR /m/
// ส่วนที่เพิ่ม: avatar/ (อวตารแยกจากตรรกะ), camera/ (Always-on + Visitor Session), interaction/ (ลำดับความสำคัญ)
// สถาปัตยกรรม 3 Controller (สื่อสารผ่าน core/event-bus.js เท่านั้น ไม่เรียกกันตรง ๆ):
//   UI Controller (idle-ui.js) · Avatar Controller (avatar/AvatarController.js) · Camera & Visitor Controller (camera/CameraVisitorController.js)
// ไฟล์นี้เป็นตัวประสานงานบทสนทนาเดิม: เรียก API/WebSocket/เสียง แล้วส่ง Event ให้อวตาร และรับ Event จากกล้อง
// สถานะหน้าจอ: idle → listening → thinking → speaking → idle  (ไม่ให้ฟังกับพูดชนกัน ผู้ใช้พูดแทรกได้)

import { api, esc, LiveSocket, sleep } from "/shared/api.js";
import { createAvatar } from "./avatar/index.js";
import { initScreenLink } from "./screen-link.js";          // 25 พ.ย. 2569: จอในวง LAN
import { CameraVisitorController } from "./camera/CameraVisitorController.js";
import { bus, EV } from "./core/event-bus.js";
import { UIController } from "./idle-ui.js";
import { InteractionManager } from "./interaction/InteractionManager.js";
import { netModeOf, netTransition, chipList } from "./interaction/net-mode.js";   // งาน F: โหมดฐานความรู้
import { greetDecision, returnWindowMs } from "./interaction/greet-policy.js";   // 16 พ.ย. 2569: ผู้เข้าชมใหม่หลังไม่เห็นใคร 8 วิ → ทักทันที
import { KIOSK_CONFIG } from "./kiosk-config.js";
import { Listener, Speaker } from "./voice.js";
import { parseVoiceCommand } from "./voice/commands.js";   // Phase 4: คำสั่งเสียง "หยุดพูด" เท่านั้น
import { parseGuideCommand } from "./voice/commands.js";   // 17 พ.ย. 2569: คำสั่งเสียงของ VORA Guide (แยกจากของเดิม)
import { VoraGuide } from "./guide/VoraGuide.js";          // 17 พ.ย. 2569: VORA Guide (Interactive Guided Tour)
import { ExperienceOrchestrator } from "./experience/ExperienceOrchestrator.js";
import { PresentationView } from "./experience/PresentationView.js";
import { SECTIONS, SpatialMenu } from "./experience/SpatialMenu.js";
import { JourneyEngine } from "./experience/JourneyEngine.js";
import { JourneyView } from "./experience/JourneyView.js";
import { ConstellationView } from "./experience/ConstellationView.js";
import { TimePortalView } from "./experience/TimePortalView.js";
import { WebPopup } from "./experience/WebPopup.js";
import { AboutPopup, ApplyOnlinePopup, SitePopup } from "./experience/InfoPopups.js";
import { VisionPopup } from "./experience/VisionPopup.js";   // 24 พ.ย. 2569: ป๊อปอัปนำเสนอสิ่งที่กล้องจำได้
import { AnnouncePopup, inQuietHours, promoCardHtml, shouldWait } from "./experience/AnnouncePopup.js";   // 27 พ.ย. 2569: ประกาศกลางจอ
import { applyTheme, currentTheme } from "/shared/theme.js";
import { HoloCore } from "./effects/HoloCore.js";

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has("debug");

const T = {
  th: {
    listeningBtn: "กำลังฟัง", placeholder: "พิมพ์คำถาม หรือกดไมค์เพื่อพูดคุย…", robotSub: "หุ่นยนต์ประชาสัมพันธ์อัจฉริยะ",
    noMic: "เบราว์เซอร์นี้ใช้ไมโครโฟนไม่ได้ พิมพ์คำถามแทนได้เลย", micDenied: "กรุณาอนุญาตการใช้ไมโครโฟน",
    noSpeech: "ไม่ได้ยินเสียง ลองพูดอีกครั้งนะคะ", netErr: "ระบบรับเสียงต้องใช้อินเทอร์เน็ต ลองพิมพ์คำถามแทนนะคะ",
    rateTitle: "วอร่าช่วยคุณได้แค่ไหน", rateSkip: "ข้าม", rateSend: "ส่งความคิดเห็น", rateThanks: "ขอบคุณสำหรับความคิดเห็นค่ะ",
    ratePh: "อยากบอกอะไรเพิ่มเติม (ไม่บังคับ)", likeThanks: "ขอบคุณที่ชอบคำตอบค่ะ", dislike: "รับทราบค่ะ หนูจะส่งให้เจ้าหน้าที่ปรับปรุงนะคะ",
    report: "แจ้งว่าคำตอบผิด", like: "ชอบคำตอบ", qrTitle: "ดูข้อมูลต่อบนมือถือ", close: "ปิด",
    photo: "ยิ้มค่ะ หนึ่ง สอง สาม แชะ ขอบคุณที่ถ่ายรูปกับวอร่านะคะ", love: "วอร่าก็รักทุกคนเหมือนกันค่ะ", stopped: "หยุดแล้วค่ะ",
    sourceKB: "ตอบจากฐานความรู้วิทยาลัย", sourceNone: "ยังไม่มีข้อมูลในระบบ",
    kinds: { admission: "รับสมัคร", activity: "กิจกรรม", news: "ข่าว", program: "แนะนำสาขา", text: "ประกาศ" },
    gestures: [["👍", "ชอบคำตอบ"], ["✋", "หยุดพูด / ทักทาย"], ["☝️", "ข่าวถัดไป"], ["✌️", "ถ่ายรูปกับวอร่า"], ["🤟", "ส่งความรัก"], ["🪧", "ชูป้ายสาขาให้กล้อง"]],
    error: "ขออภัยค่ะ เชื่อมต่อระบบไม่ได้ชั่วคราว ลองใหม่อีกครั้งนะคะ",
    // สถานะระบบ
    sysOk: "ระบบพร้อมใช้งาน", sysPartial: "ระบบทำงานบางส่วน", sysOff: "ขาดการเชื่อมต่อเซิร์ฟเวอร์", sysCheck: "กำลังตรวจสอบระบบ…", sysEstop: "หุ่นยนต์หยุดฉุกเฉิน",
    sysKb: "โหมดฐานความรู้", netAiSub: "AI ออนไลน์", netKbSub: "ไม่มีอินเทอร์เน็ต",
    netRowAi: "ออนไลน์ · โหมด AI", netRowKb: "ออฟไลน์ · ตอบจากฐานความรู้", netRowForced: "จำลองเน็ตล่ม (เจ้าหน้าที่เปิดไว้)",
    netOffline: "อินเทอร์เน็ตขัดข้อง วอร่ายังตอบจากฐานความรู้ได้ แตะคำถามด้านล่างหรือพิมพ์ถามได้เลยค่ะ",
    netBack: "อินเทอร์เน็ตกลับมาแล้ว กลับเป็นโหมด AI ค่ะ",
    camOn: "กำลังตรวจจับ", camLoading: "กำลังเปิด", camRequest: "รออนุญาต", camDenied: "ไม่ได้รับอนุญาต", camNotFound: "ไม่พบกล้อง",
    camInUse: "กล้องถูกใช้งานอยู่", camLost: "กล้องหลุด กำลังเชื่อมต่อใหม่", camError: "ขัดข้อง", camModel: "โหลดโมเดลไม่ได้",
    camStaffOff: "ปิดโดยเจ้าหน้าที่", camUnsupported: "ไม่รองรับ", camLabel: "กล้อง", retryIn: (s) => `ลองใหม่ใน ${s} วิ`,
    aiReady: (v, llm) => `พร้อม · โมเดล v${v}${llm ? " + " + llm : ""}`, aiNoModel: "ยังไม่มีโมเดล", aiOffline: "เชื่อมต่อไม่ได้",
    dbOk: (e) => `ปกติ · ${e}`, dbBad: "เชื่อมต่อไม่ได้",
    micReady: "พร้อมใช้งาน", micAsk: "รออนุญาตเมื่อกดไมค์", micDenied2: "ไม่ได้รับอนุญาต", micNone: "ไม่พบไมโครโฟน", micNoSupport: "เบราว์เซอร์ไม่รองรับ", micListening: "กำลังฟัง",
    robotReady: "พร้อมทำงาน", robotSim: "พร้อม (หุ่นจำลอง)", robotNotReady: "เชื่อมต่อแล้ว ยังไม่พร้อม", robotOff: "ไม่ได้เชื่อมต่อ",
    robotEstop: "หยุดฉุกเฉิน", robotBatt: (b) => ` · ${b}%`,
    // ลิ้นชักข้อมูล
    about: "ข้อมูลวิทยาลัย", aboutLead: "แตะหัวข้อที่สนใจ VORA จะตอบจากฐานความรู้ของวิทยาลัยค่ะ",
    aboutQs: ["วิทยาลัยอยู่ที่ไหน", "ติดต่อวิทยาลัยยังไง", "สมัครเรียนยังไง", "ค่าเทอมเท่าไหร่", "มีทุนการศึกษาไหม", "มีกิจกรรมอะไรบ้าง", "เธอเป็นใคร"],
    programs: "สาขาวิชา", programsLead: "แตะสาขาเพื่อฟังรายละเอียดและอาชีพหลังเรียนจบ", news: "ข่าวสาร / กิจกรรม", newsLead: "ข่าวและกิจกรรมที่เผยแพร่อยู่ตอนนี้",
    empty: "ยังไม่มีข้อมูลในระบบ", loadErr: "โหลดข้อมูลไม่ได้ ลองใหม่อีกครั้ง", askHint: "พูดคำถามได้เลยค่ะ หรือพิมพ์ที่ช่องด้านล่าง",
    // เครื่องมือ
    hidePanels: "โหมดหน้าจอว่าง (ซ่อนแผง)", dUi: "โหมดหน้าจอ", uiIdle: "ว่าง (Avatar Focus)", uiActive: "ใช้งาน", camOff: "ปิดกล้องและหยุดตรวจจับ", camOn2: "เปิดกล้องและเริ่มตรวจจับ",
    camStaff: "กล้องใช้ตรวจว่ามีผู้มาใช้งานเพื่อทักทาย และอ่านท่ามือ/ป้ายสาขา ภาพประมวลผลในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่บันทึกวิดีโอ ไม่ส่งภาพออก ไม่จดจำใบหน้า และใช้รหัสติดตามชั่วคราวที่ล้างทุกครั้งที่ผู้เข้าชมออกไป",
    camDeniedHelp: "กล้องยังไม่ได้รับอนุญาต: คลิกไอคอนกล้องที่แถบที่อยู่ของเบราว์เซอร์ > อนุญาต แล้วรีเฟรช ระบบส่วนอื่นยังใช้งานได้ตามปกติ",
    dCam: "สถานะกล้อง", dSession: "ผู้เข้าชม (Session)", dTracks: "รหัสติดตามชั่วคราว", dLastGreet: "ทักทายล่าสุด", dActivity: "กิจกรรมปัจจุบัน", none: "—",
    secAgo: (s) => `${s} วินาทีที่แล้ว`, people: (n) => `${n} คน`,
    act: { idle: "ว่าง", greeting: "ทักทาย", conversation: "สนทนา", announcing: "ประกาศ", safety: "หยุดฉุกเฉิน" },
  },
  en: {
    listeningBtn: "Listening", placeholder: "Type a question, or tap the mic to talk…", robotSub: "Smart PR robot",
    noMic: "Voice input isn't available in this browser. Please type instead.", micDenied: "Please allow microphone access",
    noSpeech: "I didn't catch that. Please try again.", netErr: "Voice input needs internet. Please type instead.",
    rateTitle: "How helpful was VORA?", rateSkip: "Skip", rateSend: "Send feedback", rateThanks: "Thank you for your feedback!",
    ratePh: "Anything else to tell us? (optional)", likeThanks: "Glad you liked it!", dislike: "Noted. I'll pass this to our staff.",
    report: "Report wrong answer", like: "Like this answer", qrTitle: "Continue on your phone", close: "Close",
    photo: "Smile! One, two, three. Thanks for taking a photo with me!", love: "I love you all too!", stopped: "Stopped.",
    sourceKB: "From the college knowledge base", sourceNone: "Not in the knowledge base yet",
    kinds: { admission: "Admission", activity: "Activity", news: "News", program: "Program", text: "Announcement" },
    gestures: [["👍", "Like answer"], ["✋", "Stop / say hello"], ["☝️", "Next news"], ["✌️", "Photo with VORA"], ["🤟", "Send love"], ["🪧", "Show a program sign"]],
    error: "Sorry, I can't reach the system right now. Please try again.",
    sysOk: "System ready", sysPartial: "Partially available", sysOff: "Server disconnected", sysCheck: "Checking system…", sysEstop: "Robot emergency stop",
    sysKb: "Knowledge-base mode", netAiSub: "AI online", netKbSub: "No internet",
    netRowAi: "Online · AI mode", netRowKb: "Offline · knowledge base", netRowForced: "Offline drill (staff)",
    netOffline: "The internet is down. VORA can still answer from the knowledge base. Tap a question below or type.",
    netBack: "The internet is back. AI mode is on again.",
    camOn: "Detecting", camLoading: "Starting", camRequest: "Awaiting permission", camDenied: "Permission denied", camNotFound: "No camera",
    camInUse: "In use by another app", camLost: "Disconnected, retrying", camError: "Error", camModel: "Model failed to load",
    camStaffOff: "Off (staff)", camUnsupported: "Not supported", camLabel: "Camera", retryIn: (s) => `retry in ${s}s`,
    aiReady: (v, llm) => `Ready · model v${v}${llm ? " + " + llm : ""}`, aiNoModel: "No model", aiOffline: "Unreachable",
    dbOk: (e) => `OK · ${e}`, dbBad: "Unreachable",
    micReady: "Ready", micAsk: "Asks when you tap mic", micDenied2: "Permission denied", micNone: "No microphone", micNoSupport: "Not supported", micListening: "Listening",
    robotReady: "Ready", robotSim: "Ready (simulator)", robotNotReady: "Connected, not ready", robotOff: "Not connected",
    robotEstop: "Emergency stop", robotBatt: (b) => ` · ${b}%`,
    about: "About the college", aboutLead: "Tap a topic and VORA will answer from the college knowledge base.",
    aboutQs: ["Where is the college?", "How can I contact the college?", "How do I apply?", "How much is tuition?", "Are there scholarships?", "What activities are there?", "Who are you?"],
    programs: "Programs", programsLead: "Tap a program to hear the details and careers.", news: "News & events", newsLead: "Currently published news and events.",
    empty: "Nothing here yet.", loadErr: "Couldn't load. Please try again.", askHint: "Go ahead and speak, or type below.",
    hidePanels: "Idle mode (hide panels)", dUi: "Screen mode", uiIdle: "Idle (avatar focus)", uiActive: "Active", camOff: "Turn camera off & stop detection", camOn2: "Turn camera on & start detection",
    camStaff: "The camera detects when someone arrives (to greet them) and reads hand gestures/program signs. Frames are processed only in this browser. No video is recorded or sent, no face recognition is used, and temporary tracking IDs are cleared when the visitor leaves.",
    camDeniedHelp: "Camera permission is blocked: click the camera icon in the browser address bar > Allow, then reload. Everything else keeps working.",
    dCam: "Camera", dSession: "Visitor session", dTracks: "Temporary track IDs", dLastGreet: "Last greeting", dActivity: "Current activity", none: "—",
    secAgo: (s) => `${s}s ago`, people: (n) => `${n} ${n === 1 ? "person" : "people"}`,
    act: { idle: "Idle", greeting: "Greeting", conversation: "Conversation", announcing: "Announcing", safety: "Emergency stop" },
  },
};

const S = {
  lang: "th", state: "idle", phase: "attract", sessionId: null, cfg: null, lastBotId: null, questions: 0,
  lastActivity: Date.now(), lastGreetAt: 0, rated: false, queue: [], newsIdx: 0, greetPending: 0,
  lastAttractSpeak: Date.now(), robot: null, wsOnline: false, health: null, healthErr: false, mic: "unknown",
  cam: "idle", camDetail: "", visitor: null, resumeAt: 0, currentPromo: null, drawer: null,
  net: "ai", quick: [], lastSuggestions: [],   // งาน F (21 พ.ย. 2569): ai | kb (โหมดฐานความรู้) · คำถามยอดฮิตสำหรับแตะถาม
};
// VORA NEXT Phase 2: ข้อความเพิ่ม (Privacy Pause, คำแนะนำหลังทักทาย)
Object.assign(T.th, {
  camPaused: "พักกล้องชั่วคราว", camTapPause: "แตะเพื่อพักกล้อง", camTapResume: "แตะเพื่อเปิดกล้อง",
  resumeIn: (mmss) => `กลับมาใน ${mmss}`, camBadgeOn: "กล้องทำงาน · ไม่บันทึกภาพ", privacyPaused: "พักกล้องแล้ว กล้องจะกลับมาทำงานเองใน",
  privacyResumed: "เปิดกล้องอีกครั้งแล้ว", suggestTap: (list) => `แนะนำ: ${list} — แตะหน้าจอได้เลย`,
});
Object.assign(T.en, {
  camPaused: "Paused", camTapPause: "Tap to pause camera", camTapResume: "Tap to turn camera on",
  resumeIn: (mmss) => `back in ${mmss}`, camBadgeOn: "Camera on · nothing recorded", privacyPaused: "Camera paused. It will turn back on in",
  privacyResumed: "Camera is on again", suggestTap: (list) => `Try: ${list} — just tap the screen`,
});
// 8 พ.ย. 2569: สถานะย่อยของการรับเสียง + ข้อความข้อผิดพลาดที่เข้าใจง่าย + ทดสอบเสียง (เครื่องมือเจ้าหน้าที่)
Object.assign(T.th, {
  vStarting: "กำลังเปิดไมโครโฟน…", vLive: "พูดได้เลยค่ะ หนูกำลังฟัง…", vTranscribing: "กำลังแปลงเสียงเป็นข้อความ…",
  vErr: {
    "no-speech": "ไม่ได้ยินเสียง ลองกดไมค์แล้วพูดอีกครั้งนะคะ", "audio-capture": "ไม่พบไมโครโฟน หรือไมโครโฟนถูกโปรแกรมอื่นใช้อยู่",
    "not-allowed": "ไมโครโฟนยังไม่ได้รับอนุญาต กรุณากดอนุญาตที่แถบที่อยู่ของเบราว์เซอร์", "service-not-allowed": "เบราว์เซอร์ไม่อนุญาตบริการแปลงเสียง ลองใช้ Chrome หรือ Edge",
    network: "ระบบแปลงเสียงต้องใช้อินเทอร์เน็ต ตอนนี้เชื่อมต่อไม่ได้ แตะคำถามด้านล่างหรือพิมพ์คำถามแทนได้เลยค่ะ", "language-not-supported": "เบราว์เซอร์นี้ยังไม่รองรับการฟังภาษานี้",
    "mic-timeout": "ไมโครโฟนไม่ตอบสนอง ลองกดไมค์อีกครั้งนะคะ", "start-failed": "เปิดไมโครโฟนไม่ได้ ลองกดอีกครั้งนะคะ",
    "not-supported": "เบราว์เซอร์นี้ใช้ไมโครโฟนไม่ได้ พิมพ์คำถามแทนได้เลยค่ะ", other: "รับเสียงไม่สำเร็จ ลองกดไมค์อีกครั้งนะคะ",
  },
  dVoice: "ไมโครโฟน / แปลงเสียง", dVoiceErr: "ข้อผิดพลาดล่าสุด", dTts: "เสียงพูด VORA", ttsServer: "เสียง VORA (เซิร์ฟเวอร์)", ttsBrowser: "เสียงของเบราว์เซอร์",
  testVoice: "ทดสอบเสียง VORA", voiceSamples: ["สวัสดีค่ะ ยินดีต้อนรับสู่ VORA มีอะไรให้หนูช่วยค้นหาข้อมูลไหมคะ", "แผนก Computer Technology เปิดสอนอะไรบ้างคะ", "Hello! Welcome to VORA. How can I help you today?"],
});
Object.assign(T.en, {
  vStarting: "Turning on the microphone…", vLive: "Go ahead, I'm listening…", vTranscribing: "Converting your voice to text…",
  vErr: {
    "no-speech": "I didn't hear anything. Tap the mic and try again.", "audio-capture": "No microphone found, or another program is using it.",
    "not-allowed": "Microphone permission is blocked. Please allow it in the browser's address bar.", "service-not-allowed": "This browser blocks speech recognition. Please use Chrome or Edge.",
    network: "Speech recognition needs internet and it's offline now. Tap a question below or type instead.", "language-not-supported": "This browser can't recognise this language yet.",
    "mic-timeout": "The microphone didn't respond. Please tap the mic again.", "start-failed": "Couldn't start the microphone. Please tap again.",
    "not-supported": "Voice input isn't available in this browser. Please type instead.", other: "Voice input failed. Please tap the mic and try again.",
  },
  dVoice: "Microphone / speech", dVoiceErr: "Last error", dTts: "VORA voice", ttsServer: "VORA voice (server)", ttsBrowser: "Browser voice",
  testVoice: "Test VORA voice", voiceSamples: ["สวัสดีค่ะ ยินดีต้อนรับสู่ VORA", "Hello! Welcome to VORA. How can I help you today?", "The Computer Technology department is in Building 2."],
});
const t = (k) => T[S.lang][k];

let avatar, speaker, listener, cam, ui, socket;
let webPop, sitePop, applyPop, aboutPop, visionPop, annPop;   // 12 พ.ย. 2569: ป็อปอัพเว็บไซต์วิทยาลัย / ขั้นตอนสมัครออนไลน์
let guide = null;   // 17 พ.ย. 2569: VORA Guide
let webPopDummy;   // 11 พ.ย. 2569: ป็อปอัพผลการค้นข้อมูลจากอินเทอร์เน็ต
let orch, present, menu, journey, journeyView, constellation, timePortal;  // Phase 5: timePortal = ปฏิทินกิจกรรม (Time Portal)   // Phase 3: journey = JourneyEngine (สถานะ), journeyView = การแสดงผล   // VORA NEXT Phase 1: Experience Orchestrator, Presentation View, Spatial (Orbital) Menu
const im = new InteractionManager({
  onPreempt: (cur) => {
    // ถูกแทรกโดยกิจกรรมที่สำคัญกว่า: หยุดเสียงทันที และถ้าเป็นข่าวประกาศ เก็บกลับเข้าคิวไว้ประกาศต่อภายหลัง
    speaker && speaker.stop();
    if (cur.kind === "announcing" && cur.meta) {
      S.queue.unshift({ ...cur.meta, resumed: true });
      S.resumeAt = Date.now() + KIOSK_CONFIG.ui.resumeAnnounceAfterMs;
    }
  },
  onChange: () => syncAvatar(),
});

// ====================================================================== สถานะและหน้าจอ
/** แจ้งสถานะปัจจุบันให้ Avatar Controller (อวตารเลือกท่าทาง/สี/ป้ายสถานะเอง) */
function syncAvatar() {
  if (S.state === "listening") bus.emit(EV.AVATAR_LISTENING);
  else if (S.state === "thinking") bus.emit(EV.AVATAR_THINKING);
  else if (S.state === "speaking") bus.emit(EV.AVATAR_SPEAKING, { kind: im.kind });
  else bus.emit(EV.AVATAR_IDLE);
  bus.emit(EV.AVATAR_ALERT, { error: !!(S.robot && S.robot.estop) || (!S.wsOnline && S.health === null && S.healthErr) });
}

/** สถานะย่อยของไมค์ (แสดงผลเท่านั้น ไม่ใช่สถานะใหม่ของระบบ): starting = กำลังเปิดไมค์ · live = รับเสียงอยู่จริง · transcribing = หยุดพูดแล้วกำลังแปลง · error */
function setVoice(v) {
  clearTimeout(S.voiceErrTimer);
  if (v) $("app").dataset.voice = v; else delete $("app").dataset.voice;
}

function setState(state) {
  S.state = state;
  $("app").dataset.state = state;
  if (state !== "listening" && $("app").dataset.voice !== "error") setVoice("");
  $("micBtn").setAttribute("aria-label", state === "listening" ? t("listeningBtn") : (S.lang === "en" ? "Tap to talk" : "แตะแล้วพูด"));
  socket && socket.send({ type: "state", state: S.phase === "convo" && state === "idle" ? "conversation" : state });
  syncAvatar();
  renderStatus();
  if (state === "idle") {
    // มีผู้เข้าชมใหม่ระหว่างที่วอร่ายุ่ง: ทักทายทันทีที่ว่าง
    if (S.greetPending && S.visitor && S.phase === "attract") setTimeout(() => greet(S.greetPending), 500);
    setTimeout(drainQueue, 400);
  }
}

function flashHappy(ms = 2200) { bus.emit(EV.AVATAR_EMOTION, { emotion: "happy", flashMs: ms }); }

function touch() { S.lastActivity = Date.now(); }
// 27 พ.ย. 2569: โหมดประกาศเฉพาะตาราง (ค่าเริ่มต้นเปิด) · ปิดได้ด้วย VORA_PR_SCHEDULE_ONLY=0 (กลับไปพูดเองทุก 90 วิ แบบเดิม)
const prOnly = () => !S.cfg || S.cfg.pr_schedule_only !== false;
const ANN_WAIT_MAX_MS = 30 * 60 * 1000;   // ประกาศที่รอคุยจบเกิน 30 นาที = หมดเวลา ไม่ประกาศย้อนหลัง
const emote = (emotion) => bus.emit(EV.AVATAR_EMOTION, { emotion });
const act = (name) => bus.emit(EV.AVATAR_GESTURE, { name });

function showConvo() {
  if (S.phase === "convo") return;
  S.phase = "convo";
  $("app").dataset.phase = "convo";
}

function welcomeMessage() {
  const d = document.createElement("div");
  d.className = "msg welcome";
  const g = S.cfg ? (S.lang === "en" ? S.cfg.greeting_en : S.cfg.greeting_th) : "";
  d.innerHTML = `<svg class="bot-ico" viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="16" width="44" height="36" rx="16" fill="#F3F3F5"/><rect x="16" y="22" width="32" height="22" rx="10" fill="#14161B"/><circle cx="26" cy="33" r="4" fill="#5BC8FF"/><circle cx="38" cy="33" r="4" fill="#5BC8FF"/><path d="M32 16V8" stroke="#F3F3F5" stroke-width="3"/><circle cx="32" cy="7" r="4" fill="#FFD400"/><rect x="5" y="28" width="6" height="12" rx="3" fill="#FFD400"/><rect x="53" y="28" width="6" height="12" rx="3" fill="#FFD400"/></svg><div class="txt"></div>`;
  d.querySelector(".txt").textContent = g;
  return d;
}

function resetSession() {
  S.phase = "attract";
  $("app").dataset.phase = "attract";
  S.sessionId = null; S.questions = 0; S.rated = false; S.lastBotId = null;
  $("messages").replaceChildren(welcomeMessage());
  $("media").hidden = true;
  setCaption("");
  renderChips(null);
  closeDrawer();
  nextPromo();
  setState("idle");
  if (journey) journey.clear("reset");   // Phase 3: บทสนทนาใหม่ = เส้นทางใหม่
}

function applyLang() {
  document.documentElement.lang = S.lang;
  document.querySelectorAll(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === S.lang)));
  $("askInput").placeholder = t("placeholder");
  $("robotLine").textContent = t("robotSub");
  $("rateTitle").textContent = t("rateTitle");
  $("rateSkip").textContent = t("rateSkip");
  $("rateSend").textContent = t("rateSend");
  $("rateComment").placeholder = t("ratePh");
  $("qrTitle").textContent = t("qrTitle");
  $("qrClose").textContent = t("close");
  document.querySelectorAll("[data-th]").forEach((el) => (el.textContent = el.dataset[S.lang] || el.dataset.th));
  document.querySelectorAll("[data-aria-th]").forEach((el) => el.setAttribute("aria-label", (S.lang === "en" && el.dataset.ariaEn) || el.dataset.ariaTh));
  $("gestureList").innerHTML = t("gestures").map(([i, l]) => `<li><b>${i}</b>${esc(l)}</li>`).join("");
  if (S.cfg) $("schoolName").textContent = S.lang === "en" ? S.cfg.school_name_en : S.cfg.school_name_th;
  bus.emit(EV.UI_LANG, { lang: S.lang });
  const w = $("messages").querySelector(".welcome");
  if (w) w.replaceWith(welcomeMessage());
  if (S.drawer) openDrawer(S.drawer);
  setState(S.state);
  renderChips(null);
  renderStatus();
  renderClock();
  updateToolsSheet();
}

function toast(msg, ms = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

function setCaption(text, partial = false) { bus.emit(EV.AVATAR_CAPTION, { text, partial }); }

function renderChips(list) {
  // ค่าเริ่มต้นมีปุ่มด่วน 4 ปุ่มอยู่แล้ว แสดงชิปเฉพาะคำถามแนะนำต่อเนื่องจาก AI
  // งาน F (21 พ.ย. 2569): โหมดฐานความรู้ → แสดงคำถามยอดฮิตที่ตอบได้ (และมีเสียงเตรียมไว้) แทน ให้แตะถามได้เมื่อไมค์ใช้ไม่ได้
  if (list !== undefined) S.lastSuggestions = list || [];
  const items = chipList(S.net, S.lastSuggestions, S.quick);
  $("chips").replaceChildren(...items.map((q) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = q;
    b.onclick = () => ask(q, "text");
    return b;
  }));
}

function scrollMessages() { const m = $("messages"); m.scrollTop = m.scrollHeight; }

function addUser(text) {
  const d = document.createElement("div");
  d.className = "msg user";
  d.textContent = text;
  $("messages").appendChild(d);
  scrollMessages();
}

function addTyping() {
  const d = document.createElement("div");
  d.className = "msg bot";
  d.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  $("messages").appendChild(d);
  scrollMessages();
  return d;
}

function addBot(res, extraClass = "") {
  const d = document.createElement("div");
  d.className = `msg bot ${res.answered === false ? "sorry" : ""} ${extraClass}`;
  const p = document.createElement("div");
  p.textContent = res.text;
  d.appendChild(p);
  if (res.message_id) {
    const meta = document.createElement("div");
    meta.className = "meta";
    const src = res.provider === "vision" ? "👁 " : "";
    meta.innerHTML = `<span class="src">${src}${esc(res.answered === false ? t("sourceNone") : t("sourceKB"))}</span>`;
    const up = Object.assign(document.createElement("button"), { className: "thumb", textContent: "👍" });
    const down = Object.assign(document.createElement("button"), { className: "thumb", textContent: "👎" });
    up.setAttribute("aria-label", t("like")); down.setAttribute("aria-label", t("report"));
    up.setAttribute("aria-pressed", "false"); down.setAttribute("aria-pressed", "false");
    up.onclick = () => { sendThumb(res.message_id, 1); up.setAttribute("aria-pressed", "true"); down.setAttribute("aria-pressed", "false"); };
    down.onclick = () => { sendThumb(res.message_id, -1); down.setAttribute("aria-pressed", "true"); up.setAttribute("aria-pressed", "false"); };
    meta.append(up, down);
    d.appendChild(meta);
    d.dataset.mid = res.message_id;
  }
  $("messages").appendChild(d);
  scrollMessages();
  if (res.message_id) S.lastBotId = res.message_id;
}

function renderMedia(media) {
  const box = $("media");
  const parts = [];
  if (media && (media.video || media.image)) {
    const m = media.video
      ? `<video src="${esc(media.video)}" autoplay muted loop playsinline></video>`
      : `<img src="${esc(media.image)}" alt="">`;
    const first = (media.cards || [])[0];
    parts.push(`<div class="hero">${m}<div><strong>${esc(first ? first.title : "")}</strong><p>${esc(first ? first.subtitle : "")}</p></div></div>`);
  }
  if (media && media.cards && media.cards.length > 1) {
    parts.push(`<div class="cards">${media.cards.map((c) => `
      <button class="card" data-type="${esc(c.type)}" data-id="${esc(c.id)}">
        ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : ""}
        <div class="t">${esc(c.title)}</div><div class="s">${esc(c.subtitle || "")}</div>
      </button>`).join("")}</div>`);
  }
  box.innerHTML = parts.join("");
  box.hidden = !parts.length;
  box.querySelectorAll(".card").forEach((b) => (b.onclick = () => openCard(b.dataset.type, +b.dataset.id)));
}

// ====================================================================== การพูด (ผ่านผู้จัดการลำดับความสำคัญเสมอ)
/** พูดข้อความหนึ่งครั้ง คืน true ถ้าพูดจบโดยไม่ถูกแทรก */
async function speakAs(token, text, lang) {
  if (!im.holds(token)) return false;
  setCaption(text);
  setState("speaking");
  await speaker.speak(text, lang || S.lang);
  const ok = im.holds(token);
  if (ok) { im.end(token); if (S.state === "speaking") setState("idle"); }
  // 11 พ.ย. 2569: ซ่อนกล่องคำพูดหลังพูดจบ 15 วินาที (ถ้ายังเป็นข้อความเดิมและไม่ได้เริ่มฟัง/คิด/พูดรอบใหม่)
  clearTimeout(S.bubbleTimer);
  if (ok) S.bubbleTimer = setTimeout(() => {
    if (avatar.bubbleText === text && !["speaking", "listening", "thinking"].includes(S.state)) setCaption("");
  }, BUBBLE_HIDE_MS);
  return ok;
}
const BUBBLE_HIDE_MS = 15000;

async function respond(res, { record = true, kind = "conversation", user = false, token = null } = {}) {
  const tok = token && im.holds(token) ? token : im.begin(kind, { user });
  if (!tok) return false;
  if (annPop && annPop.open) annPop.close("answer");
  if (res.session_id) S.sessionId = res.session_id;
  showConvo();
  if (record) addBot(res);
  renderMedia(res.media);
  renderChips(res.suggestions);
  emote(res.emotion === "sorry" ? "sorry" : res.emotion === "happy" ? "happy" : "neutral");
  if (res.gesture) act(res.robot_action || res.gesture);
  const web = res.media && res.media.web;
  if (res.media && res.media.web_error) console.warn("[VORA] ค้นเว็บไม่สำเร็จ:", res.media.web_error);
  if (web && webPop) webPop.show(web, res.message_id, res.lang || S.lang);
  if (res.media && res.media.site && sitePop) sitePop.show(res.media.site, res.lang || S.lang);
  if (res.media && res.media.apply_online && applyPop) applyPop.show(res.media.apply_online, res.lang || S.lang);   // 11 พ.ย. 2569: แสดงผลการค้นเป็นป็อปอัพกลางจอ
  if (visionPop && res.media) {   // 24 พ.ย. 2569: เห็นสิ่งที่รู้จัก → ป๊อปอัปนำเสนอ · ถามต่อ → คำตอบล่าสุด · ถามเรื่องอื่น/สั่งปิด → ปิด
    const vi = res.media.vision_item;
    if (res.media.vision_close) visionPop.close("question");
    else if (vi && (vi.focus === "summary" || !visionPop.open)) visionPop.show(vi, res.lang || S.lang);
    else if (vi) visionPop.update(vi, res.text);
  }
  const done = await speakAs(tok, res.text, res.lang || S.lang);
  touch();
  if (done && web && webPop && webPop.open && webPop.answered === null) {
    // พูดสรุปจบแล้ว → ถามกลับว่าข้อมูลถูกต้องไหม (ตอบได้ด้วยปุ่มในป็อปอัพ หรือชูนิ้วโป้งขึ้น/ลง ภายใน 5 นาที)
    await respond({ text: S.lang === "en" ? "Is the information I found correct? Tap correct or not correct, or show me a thumbs up or down."
      : "ข้อมูลที่หนูหามานี้ถูกต้องไหมคะ แตะถูกต้องหรือไม่ถูกต้อง หรือชูนิ้วโป้งบอกหนูได้เลยค่ะ", lang: S.lang, gesture: "explain", emotion: "happy", answered: true }, { record: false });
  }
  // 12 พ.ย. 2569: แนะนำวิทยาลัย → พูดจบแล้วแสดงช่องทางติดต่อ (ไม่แสดงถ้าผู้ใช้ถามเรื่องใหม่แทรกระหว่างพูด)
  if (res.media && res.media.about && aboutPop && done) aboutPop.show(res.media.about, res.lang || S.lang);
  if (done && res.intent === "thanks_bye" && S.questions >= 1) setTimeout(() => openRating(), 600);
  return done;
}

async function ask(text, mode = "text", { internal = false } = {}) {
  text = (text || "").trim();
  if (!text) return;
  if (!internal && guide && guide.active) guide.end("question");   // VORA Guide: คำถามใหม่ระหว่าง Guide = จบ Guide ก่อน แล้วระบบเดิมรับคำถามตามปกติ
  if (!internal && guide && guide.available && parseGuideCommand(text) === "GUIDE_START") { guide.start("text"); return; }   // 25 พ.ย. 2569: พิมพ์ "แนะนำการใช้งาน" → เปิด Guide (เดิมเฉพาะเสียง)
  if (!internal && await lookAndAnswer(text)) return;   // 24 พ.ย. 2569: "นี่คืออะไร" → ดูจากกล้อง
  // Phase 3: ผู้ใช้ถามแทรกระหว่างเส้นทาง → เส้นทางคงอยู่ที่ขั้นเดิม (นับไว้เพื่อรายงาน)
  if (!internal && journey && journey.active && orch && orch.section === "journey") journey.interject();
  touch();
  closeDrawer();
  listener.stop(true);
  const tok = im.begin("conversation", { user: true });   // ผู้ใช้สั่งเอง: แทรกการทักทาย/ประกาศได้ทันที
  speaker.stop();
  showConvo();
  addUser(text);
  S.questions++;
  setCaption(text, true);
  setState("thinking");
  const typing = addTyping();
  try {
    // บริบทจากหน้าจอ: สาขาที่กำลังแสดงอยู่ในโหมดนำเสนอ (ให้ "สาขานี้…" หมายถึงสาขาบนจอ ไม่ใช่สาขาที่คุยไว้ก่อนหน้า)
    const contextProgram = orch && orch.isPresenting() && present ? present.currentProgramId() : null;
    const visionItem = visionPop && visionPop.open ? visionPop.itemId : null;   // 24 พ.ย. 2569: ป๊อปอัปเปิดอยู่ → ถามเรื่องสิ่งนั้น
    if (visionItem) visionPop.keepAlive();
    const res = await api("/api/chat", { method: "POST", body: { text, session_id: S.sessionId, lang: S.lang, channel: "kiosk", input_mode: mode,
      ...(contextProgram ? { context_program_id: contextProgram } : {}), ...(visionItem ? { vision_item_id: visionItem } : {}) }, timeout: 25000 });
    typing.remove();
    if (!im.holds(tok)) { if (S.state === "thinking") setState("idle"); return res; }   // ถูกหยุดระหว่างรอคำตอบ
    await respond(res, { token: tok });
    return res;   // Phase 3: Journey ใช้คำตอบจริงจาก AI แสดงในขั้นการสมัคร
  } catch (e) {
    typing.remove();
    if (!im.holds(tok)) { if (S.state === "thinking") setState("idle"); return; }
    await respond({ text: t("error"), answered: false, emotion: "sorry", gesture: "shrug", lang: S.lang }, { token: tok });
  }
}

function startListening() {
  touch();
  if (annPop && annPop.open) annPop.close("user");
  if (S.state === "listening") { listener.stop(); return; }
  if (!listener.supported) { toast(t("noMic")); $("askInput").focus(); return; }
  im.begin("conversation", { user: true });    // ผู้ใช้พูดแทรกได้ทันที
  speaker.stop();
  if (listener.start(S.lang)) { setState("listening"); setVoice("starting"); setCaption(t("vStarting"), true); }
}

/** ข้อผิดพลาดของการรับเสียง: บอกผู้ใช้ด้วยข้อความเข้าใจง่าย → กลับสถานะว่าง กดไมค์ใหม่ได้ทันที (ไม่ค้างกำลังฟัง) */
function onVoiceError(code) {
  const msg = t("vErr")[code] || t("vErr").other;
  S.voiceError = { code, at: Date.now() };
  socket && socket.send({ type: "event", data: { kind: "voice", name: "error", code } });
  if (S.state === "listening") setState("idle");
  setVoice("error");
  setCaption(msg);
  if (code !== "no-speech") toast(msg, 5000);
  if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") checkMic();
  if (code === "network") loadQuick().then(() => { if (S.net !== "kb") S.lastSuggestions = S.quick.slice(0, 3); renderChips(); });   // งาน F
  S.voiceErrTimer = setTimeout(() => { if ($("app").dataset.voice === "error") setVoice(""); if (avatar.bubbleText === msg) setCaption(""); }, 6000);
}

// ====================================================================== ทักทายผู้เข้าชม
async function greet(people = 1, { force = false, arrival = false, quietMs = null } = {}) {
  if (!S.cfg) return;
  clearTimeout(S.greetTimer);
  // 16 พ.ย. 2569: การตัดสินใจย้ายไป interaction/greet-policy.js (กติกาเดิมครบ + arrival = ผู้เข้าชมใหม่หลังไม่เห็นใครครบ absenceGreetMs)
  const cooldown = (KIOSK_CONFIG.visitor.greetCooldownS ?? S.cfg.greeting_cooldown_s ?? 25) * 1000;
  const decision = greetDecision({ force, arrival, autoGreeting: !!S.cfg.auto_greeting, phase: S.phase, state: S.state, speakingKind: im.kind,
    quietMs: quietMs ?? Date.now() - S.lastActivity, sinceGreetMs: Date.now() - S.lastGreetAt, cooldownMs: cooldown,
    absenceGreetMs: KIOSK_CONFIG.visitor.absenceGreetMs ?? 8000 });
  if (decision === "skip") { S.greetPending = 0; return; }
  if (decision === "wait") { S.greetPending = people; return; }   // กำลังฟัง/คิด หรือกำลังตอบผู้ใช้: ไม่ตัดบท รอทักทายเมื่อว่าง (ถ้าผู้เข้าชมยังอยู่)
  if (decision === "cooldown") {
    // ยังอยู่ในคูลดาวน์ (เพิ่งทักคนก่อน): ไม่ทิ้ง — ถ้าผู้เข้าชมคนนี้ยังยืนอยู่และยังไม่ถูกทัก จะทักเมื่อพ้นคูลดาวน์
    S.greetPending = 0;
    const session = S.visitor;
    if (session && !session.greeted) S.greetTimer = setTimeout(() => { if (S.visitor === session && !session.greeted) greet(session.people); }, cooldown - (Date.now() - S.lastGreetAt) + 300);
    return;
  }
  if (decision === "greet-reset") { S.greetPending = 0; resetSession(); }   // บทสนทนาของคนก่อนค้างอยู่: ล้างก่อนทักผู้เข้าชมใหม่ (แบบเดียวกับปุ่มทดสอบการทักทาย)
  const tok = im.begin("greeting");          // แทรกการประกาศข่าวได้ (ข่าวจะกลับเข้าคิว)
  if (!tok) { S.greetPending = people; return; }
  S.greetPending = 0;
  S.lastGreetAt = Date.now();
  if (S.visitor) S.visitor.greeted = true;
  try {
    const res = await api("/api/greet", { method: "POST", body: { session_id: S.sessionId, lang: S.lang, trigger: "face", people,
      context: (orch && orch.section) || null, emoji: true } });   // 16 พ.ย. 2569: คำทักทายตามบริบท (หน้านำเสนอที่เปิดอยู่) · emoji: หน้าจอนี้ตัด Emoji ก่อนส่งเสียงพูด (speechChunks)
    if (!im.holds(tok)) return;
    bus.emit(EV.GREETING_STARTED, { people });
    await respond({ ...res, answered: true, message_id: null }, { token: tok, kind: "greeting" });
    bus.emit(EV.GREETING_FINISHED, { people });
    // ส่งสถานะอวตารปัจจุบันซ้ำหลังจบการทักทาย ให้ลำดับ Event เป็นไปตามที่เอกสารกำหนดเสมอ
    // (GREETING_FINISHED → AVATAR_IDLE) — เดิมขึ้นกับจังหวะที่สถานะหุ่นยนต์ส่งมาทาง WebSocket
    syncAvatar();
    suggestAfterGreeting();
  } catch {
    im.end(tok);   // เงียบไว้ ไม่รบกวนผู้ใช้
    if (S.state !== "idle") setState("idle");
  }
}

async function sendThumb(messageId, rating) {
  touch();
  try {
    await api("/api/feedback", { method: "POST", body: { session_id: S.sessionId || "", message_id: messageId, kind: rating < 0 ? "wrong_answer" : "thumb", rating } });
    toast(rating > 0 ? t("likeThanks") : t("dislike"));
    emote(rating > 0 ? "happy" : "sorry");
    act(rating > 0 ? "happy" : "nod");
    if (rating > 0) flashHappy();
  } catch (e) { toast(e.message); }
}

async function openCard(type, id) {
  touch();
  closeDrawer();
  try {
    if (type === "program") {
      const p = await api(`/api/programs/${id}`);
      const name = S.lang === "en" ? p.name_en : p.name_th;
      const text = S.lang === "en" ? `${p.name_en}${p.level ? ` (${p.level})` : ""}: ${p.description_en} Careers: ${p.careers_en}`
        : `สาขา${p.name_th}${p.level ? ` ระดับ ${p.level}` : ""} ${p.description_th} จบแล้วทำงานเป็น ${p.careers_th}`;
      addUser(name);
      await respond({ text, lang: S.lang, gesture: "present", emotion: "happy", media: { image: p.image, video: p.video, cards: [{ title: name, subtitle: p.level || p.department }] },
        suggestions: S.lang === "en" ? ["How do I apply?", "Is there a scholarship?"] : ["สมัครเรียนยังไง", "มีทุนไหม"] }, { user: true });
    } else {
      const n = await api(`/api/news/${id}`);
      const title = S.lang === "en" && n.title_en ? n.title_en : n.title_th;
      const body = S.lang === "en" && n.body_en ? n.body_en : n.body_th;
      addUser(title);
      await respond({ text: `${title} ${body}`, lang: S.lang, gesture: "point_screen", emotion: "happy", media: { image: n.image, video: n.video, cards: [{ title, subtitle: t("kinds")[n.kind] }] } }, { user: true });
    }
  } catch (e) { toast(e.message); }
}

/** ปุ่มหยุด (Esc / ✋) — หยุดเสียงที่กำลังเล่นจริง หยุดการฟัง และเรียก /api/robot/stop เหมือนเดิม */
function stopAll({ quiet = true } = {}) {
  // ผู้ใช้สั่งหยุด (ปุ่มหยุด / Esc / ท่ามือ ✋): ไม่เริ่มพูดประกาศทันทีหลังหยุด · เจ้าหน้าที่เริ่มบทสนทนาใหม่ = ไม่ต้องรอ
  if (quiet) S.quietUntil = Date.now() + 5000;
  const tok = im.begin("safety");
  listener.stop(true);
  speaker.stop();
  api("/api/robot/stop", { method: "POST" }).catch(() => {});
  im.end(tok);
  setState("idle");
  setCaption(t("stopped"));
  setTimeout(() => { if (avatar.bubbleText === t("stopped")) setCaption(""); }, 2500);
}

/** Phase 4: คำสั่งเสียง "หยุดพูด" — หยุดเสียงที่เล่นอยู่ (ไฟล์/สตรีม/เสียงเบราว์เซอร์) และคืนสถานะ Speaker
 *  ไม่ส่งคำว่า "หยุดพูด" ไปถาม AI · ไม่สั่งหุ่นยนต์ (ต่างจาก stopAll ที่เป็นปุ่มหยุดฉุกเฉิน) · ไม่เริ่มประกาศทันทีหลังหยุด */
function stopSpeaking() {
  S.quietUntil = Date.now() + 5000;
  speaker.stop();
  if (S.state === "listening" || S.state === "speaking") setState("idle");
  setCaption(t("stopped"));
  setTimeout(() => { if (avatar.bubbleText === t("stopped")) setCaption(""); }, 2500);
}

/** VORA Guide (17 พ.ย. 2569): คำสั่งเสียงของ Guide — ตรวจก่อน "หยุดพูด" และก่อนส่งเข้า AI
 *  คืน false เมื่อไม่ใช่คำสั่งของ Guide (หรือ Guide ไม่ได้เปิด) → ระบบเดิมทำงานตามปกติทุกประการ · ไม่เปิดไมค์เอง */
function onGuideVoice(txt) {
  if (!guide) return false;
  const cmd = parseGuideCommand(txt);
  if (!cmd) return false;
  if (!guide.active && !(cmd === "GUIDE_START" && guide.available)) return false;
  if (S.state === "listening") setState("idle");   // จบรอบการฟังนี้ (แบบเดียวกับ stopSpeaking)
  return guide.active ? guide.command(cmd) : guide.start("voice");
}

// ====================================================================== ประชาสัมพันธ์อัตโนมัติ
function enqueue(item) {
  if (prOnly()) {
    const key = `${item.kind}:${item.id}`;
    S.queue = S.queue.filter((q) => `${q.kind}:${q.id}` !== key || q.id == null);
    item = { queuedAt: Date.now(), ...item };
  }
  S.queue.push(item);
  S.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (S.queue.length > 5) S.queue.length = 5;
  drainQueue();
}

/** ประกาศระดับปกติจะ "พัก" ระหว่างที่มีผู้เข้าชมอยู่หน้าหุ่นหรือกำลังสนทนา เพื่อไม่รบกวน แล้วกลับมาประกาศต่อเมื่อว่าง */
function announcePaused(item) {
  // 27 พ.ย. 2569: รอคุยจบ = คนเดินออก หรือเงียบ 45 วินาที แล้วรออีก 8 วินาที · ด่วน (ความสำคัญ 5) แทรกได้
  if (prOnly()) return shouldWait({ priority: item.priority || 0, phase: S.phase, visitor: !!S.visitor, quietMs: Date.now() - S.lastActivity, resumeAt: S.resumeAt });
  if ((item.priority || 0) >= 4) return false;           // ข้อความด่วนจากเจ้าหน้าที่ (say) ไม่พัก
  if (S.visitor || S.phase === "convo") return true;
  return Date.now() < S.resumeAt;
}

async function drainQueue() {
  if (S.state !== "idle" || !S.queue.length || im.current) return;
  // หลังกดหยุด (Esc/✋) เงียบสักครู่ก่อนประกาศต่อ — รวมข้อความความสำคัญสูง ไม่ทิ้งข้อความใด แค่เลื่อนเวลา
  if (Date.now() < (S.quietUntil || 0)) { clearTimeout(S.quietTimer); S.quietTimer = setTimeout(drainQueue, S.quietUntil - Date.now() + 50); return; }
  if (prOnly()) return drainQueuePR();
  if (announcePaused(S.queue[0])) return;
  const item = S.queue.shift();
  const text = S.lang === "en" && item.text_en ? item.text_en : item.text_th;
  if (!text) return;
  const tok = im.begin("announcing", { meta: item });
  if (!tok) { S.queue.unshift(item); return; }
  if (S.phase === "attract") showPromo(item);
  else addBot({ text }, "announce");
  act(item.kind === "program" ? "present" : "point_screen");
  await speakAs(tok, text, S.lang);
}

/** 27 พ.ย. 2569: ประกาศจากตาราง — ระหว่างคุยขึ้นกล่องข้อความเงียบ (ไม่พูด ไม่มีภาพ) แล้วประกาศเต็มเมื่อคุยจบ */
async function drainQueuePR() {
  S.queue = S.queue.filter((q) => !q.queuedAt || (q.priority || 0) >= 5 || Date.now() - q.queuedAt < ANN_WAIT_MAX_MS);
  if (!S.queue.length) return;
  const item = S.queue[0];
  const text = S.lang === "en" && item.text_en ? item.text_en : item.text_th;
  if (!text) { S.queue.shift(); return; }
  if (announcePaused(item)) {
    for (const q of S.queue) if (!q.previewed && !q.resumed && (q.priority || 0) < 5) { q.previewed = true; announceWaitBox(q); }
    return;
  }
  S.queue.shift();
  const tok = im.begin("announcing", { meta: item });
  if (!tok) { S.queue.unshift(item); return; }
  hidePromoCard();
  if (annPop) annPop.show(item, S.lang);
  if (S.phase !== "attract" && !item.previewed) addBot({ text }, "announce");
  act(item.kind === "program" ? "present" : "point_screen");
  const spoke = await speakAs(tok, text, S.lang);
  if (annPop && annPop.open) {
    if (spoke && annPop.video) await annPop.playVideoSound();       // วอร่าพูดจบ → เปิดเสียงวิดีโอเล่นต่อจนจบคลิป
    else if (spoke) await sleep(2500);                                // ให้อ่านทันก่อนปิด
    if (annPop.open) annPop.close("done");
  }
  if (S.queue.length) setTimeout(drainQueue, 1500);
}

function announceWaitBox(item) {
  const title = (S.lang === "en" && item.title_en ? item.title_en : item.title_th) || "";
  const text = S.lang === "en" && item.text_en ? item.text_en : item.text_th;
  const d = document.createElement("div");
  d.className = "msg bot announce announce-wait";
  d.innerHTML = `<span class="aw-tag">📢 ${esc(S.lang === "en" ? "Announcement (will be read out after your chat)" : "ประกาศ (วอร่าจะประกาศอีกครั้งเมื่อคุยจบ)")}</span>`;
  const p = document.createElement("div");
  p.textContent = title && !text.includes(title) ? `${title} — ${text}` : text;
  d.appendChild(p);
  $("messages").appendChild(d);
  scrollMessages();
}

// การ์ดหมุนเวียนช่วงหน้าจอว่าง (ไม่พูด) — เจ้าหน้าที่เลือกในหลังบ้าน: rotate = หมุนแสดง · off = ไม่มีอะไรหมุน
function hidePromoCard() { const c = $("promoCard"); if (c) c.hidden = true; }
function showPromoCard(p) {
  let c = $("promoCard");
  if (!c) {
    c = Object.assign(document.createElement("button"), { id: "promoCard", className: "promo-card", type: "button" });
    c.hidden = true;
    c.onclick = () => { const x = S.currentPromo; if (x && x.id != null) openCard(x.kind === "program" ? "program" : "news", x.id); };
    $("app").after(c);
  }
  const html = promoCardHtml(p, S.lang);
  if (!html || S.phase !== "attract" || (annPop && annPop.open)) { c.hidden = true; return; }
  S.currentPromo = p;
  c.classList.add("fade");
  setTimeout(() => { c.innerHTML = html; c.hidden = false; requestAnimationFrame(() => c.classList.remove("fade")); }, c.hidden ? 0 : 450);
}

function showPromo(p) {
  if (!p || p.kind === "none") return;
  S.currentPromo = p;
  const box = $("media");
  if (S.phase !== "attract") return;
  const title = S.lang === "en" && p.title_en ? p.title_en : p.title_th;
  const m = p.video ? `<video src="${esc(p.video)}" autoplay muted loop playsinline></video>` : p.image ? `<img src="${esc(p.image)}" alt="">` : "";
  box.innerHTML = `<div class="hero">${m}<div><strong>${esc(t("kinds")[p.news_kind || p.kind] || "")}</strong><p>${esc(title || "")}</p></div></div>`;
  box.hidden = !title;
}

async function nextPromo(speak = false) {
  if (prOnly()) {
    if (!S.cfg || S.cfg.idle_mode !== "rotate" || S.phase !== "attract") { hidePromoCard(); return; }
    try { showPromoCard(await api("/api/promo/next")); } catch { /* ignore */ }
    return;
  }
  try {
    const p = await api("/api/promo/next");
    showPromo(p);
    if (speak && p.kind !== "none") enqueue({ ...p, priority: 1 });
  } catch { /* ignore */ }
}

async function nextNews() {
  try {
    const items = await api(`/api/news?limit=8&lang=${S.lang}`);
    if (!items.length) return;
    const n = items[S.newsIdx++ % items.length];
    await openCard("news", n.id);
  } catch { /* ignore */ }
}

// ====================================================================== เมนูและลิ้นชักข้อมูล (ข้อมูลจริงจาก API)
function closeDrawer() {
  S.drawer = null;
  $("drawer").hidden = true;
  document.querySelectorAll(".nav").forEach((b) => b.classList.remove("on"));
}

async function openDrawer(kind) {
  S.drawer = kind;
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("on", b.dataset.nav === kind));
  const body = $("drawerBody");
  $("drawer").hidden = false;
  $("drawerTitle").textContent = t(kind);
  const lead = (txt) => `<p class="lead">${esc(txt)}</p>`;
  if (kind === "about") {
    const name = S.cfg ? (S.lang === "en" ? S.cfg.school_name_en : S.cfg.school_name_th) : "";
    body.innerHTML = `${lead(name ? `${name} — ${t("aboutLead")}` : t("aboutLead"))}<div class="dlist">${t("aboutQs").map((q) => `<button class="qa" data-q="${esc(q)}"><span class="t">${esc(q)}</span></button>`).join("")}</div>`;
    body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => ask(b.dataset.q, "text")));
    return;
  }
  body.innerHTML = `${lead(kind === "programs" ? t("programsLead") : t("newsLead"))}<div class="empty">…</div>`;
  try {
    const items = kind === "programs" ? await api(`/api/programs?lang=${S.lang}`) : await api(`/api/news?limit=20&lang=${S.lang}`);
    if (S.drawer !== kind) return;
    const list = items.map((it) => {
      const title = kind === "programs" ? (S.lang === "en" ? it.name_en : it.name_th) : (S.lang === "en" && it.title_en ? it.title_en : it.title_th);
      const sub = kind === "programs" ? `${it.level}${it.department ? " · " + it.department : ""}` : (it.event_date || "");
      const tag = kind === "news" ? `<span class="k">${esc(t("kinds")[it.kind] || it.kind)}</span>` : "";
      return `<button data-type="${kind === "programs" ? "program" : "news"}" data-id="${it.id}">${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : ""}<span><span class="t">${tag}${esc(title)}</span><span class="s">${esc(sub)}</span></span></button>`;
    }).join("");
    body.innerHTML = lead(kind === "programs" ? t("programsLead") : t("newsLead")) + (items.length ? `<div class="dlist">${list}</div>` : `<div class="empty">${esc(t("empty"))}</div>`);
    body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => openCard(b.dataset.type, +b.dataset.id)));
  } catch {
    if (S.drawer === kind) body.innerHTML = `<div class="empty">${esc(t("loadErr"))}</div>`;
  }
}

function onNav(kind) {
  touch();
  if (kind === "ask") {
    closeDrawer();
    document.querySelector('.nav[data-nav="ask"]')?.classList.add("on");      // 11 พ.ย. 2569: เมนูเพิ่มเติมถูกตัด ปุ่มนี้อาจไม่มี
    setTimeout(() => document.querySelector('.nav[data-nav="ask"]')?.classList.remove("on"), 1500);
    if (listener.supported) startListening(); else { toast(t("askHint")); $("askInput").focus(); }
    return;
  }
  if (kind === "rate") { closeDrawer(); openRating(true); return; }
  if (S.drawer === kind) { closeDrawer(); return; }
  openDrawer(kind);
}

// ====================================================================== กล้อง ท่าทาง และผู้เข้าชม
async function onGesture(name) {
  touch();
  socket.send({ type: "event", data: { kind: "gesture", name } });
  api("/api/interaction", { method: "POST", body: { kind: "gesture", name, session_id: S.sessionId, lang: S.lang } })
    .then((r) => { if (r && r.session_id) S.sessionId = r.session_id; }).catch(() => {});
  switch (name) {
    case "Thumb_Up": if (webPop && webPop.open && webPop.answered === null) webPop.answer(1); else if (S.lastBotId) sendThumb(S.lastBotId, 1); else { emote("happy"); act("happy"); flashHappy(); } break;
    case "Thumb_Down": if (webPop && webPop.open && webPop.answered === null) webPop.answer(-1); else if (S.lastBotId) sendThumb(S.lastBotId, -1); break;
    case "Open_Palm": if (S.state === "speaking" || S.state === "listening") stopAll(); else if (S.phase === "attract") greet(1); break;
    case "Pointing_Up": nextNews(); break;
    case "Victory": {
      const f = $("flash"); f.hidden = false; f.style.animation = "none"; void f.offsetWidth; f.style.animation = "";
      setTimeout(() => (f.hidden = true), 600);
      emote("happy"); act("happy");
      await respond({ text: t("photo"), lang: S.lang, gesture: "happy", emotion: "happy" }, { record: false, user: true });
      break;
    }
    case "ILoveYou": emote("happy"); await respond({ text: t("love"), lang: S.lang, gesture: "happy", emotion: "happy" }, { record: false, user: true }); break;
    default: break;
  }
}

// 24 พ.ย. 2569: ผู้ใช้ถาม "นี่คืออะไร / รู้จักอันนี้ไหม" ขณะชูของให้กล้อง → จำได้ = ตอบเหมือนเห็นป้าย · ไม่รู้จัก = บอกตรง ๆ + บันทึกภาพย่อให้เจ้าหน้าที่
const WHAT_IS = /((^นี่|อันนี้|ตัวนี้|ป้ายนี้|รูปนี้|ภาพนี้|โปสเตอร์นี้|ชิ้นนี้)\s*(คือ)?\s*อะไร|รู้จัก(อันนี้|นี่|ป้ายนี้|รูปนี้|ภาพนี้|โปสเตอร์นี้|ชิ้นนี้)|ช่วยดู(อันนี้|นี่|รูปนี้|ภาพนี้|ให้หน่อย)|what('s| is) this|do you (know|recogni[sz]e) this)/i;
async function lookAndAnswer(text) {
  if (text.length > 40 || !WHAT_IS.test(text) || (visionPop && visionPop.open) || !cam || !cam.frameSnapshot) return false;
  const snap = cam.frameSnapshot();
  if (!snap) return false;                                    // กล้องปิด/ยังไม่พร้อม → ถามแบบปกติ
  if (snap.ok) { await onSign(snap.best.label, snap.best.prob, { force: true }); return true; }
  touch();
  const tok = im.begin("conversation", { user: true });
  speaker.stop();
  showConvo();
  addUser(text);
  S.questions++;
  setState("thinking");
  try {
    const r = await api("/api/vision/unknown", { method: "POST", body: { thumbnail: snap.thumb, embedding: snap.vec || [], question: text.slice(0, 200),
      best_label: snap.best ? snap.best.label : "", best_prob: snap.best ? snap.best.prob : 0, lang: S.lang } });
    await respond({ text: r.text, lang: r.lang || S.lang, gesture: "shrug", emotion: "sorry", answered: false }, { token: tok });
  } catch { im.end(tok); setState("idle"); }
  return true;
}

async function onSign(label, prob, { force = false } = {}) {
  if (!force && visionPop && visionPop.open) return;      // ป๊อปอัปเปิดอยู่ → ไม่สลับไปสิ่งใหม่เอง (ปิดก่อน หรือถาม "นี่คืออะไร")
  if (S.state === "speaking" && im.kind === "conversation") return;
  if (S.state === "thinking" || S.state === "listening") return;
  touch();
  const tok = im.begin("conversation", { user: true });
  speaker.stop();
  setState("thinking");
  try {
    const res = await api("/api/vision/recognized", { method: "POST", body: { label, confidence: prob, session_id: S.sessionId, lang: S.lang } });
    showConvo();
    addUser(`📷 ${S.lang === "en" ? "Showed a sign" : "ชูป้ายให้กล้อง"}`);
    S.questions++;
    await respond(res, { token: tok });
  } catch { im.end(tok); setState("idle"); }
}

/** รับ Event จาก Camera & Visitor Controller (ไม่ได้ทำให้หน้าจอเปลี่ยนเป็น Active — อวตารทักทายได้ในโหมด Idle) */
function wireCameraEvents() {
  bus.on(EV.VISITOR_DETECTED, ({ session }) => {
    S.visitor = session;
    $("app").dataset.person = "1";
    const quietMs = Date.now() - S.lastActivity;   // 16 พ.ย. 2569: หน้าจอเงียบมานานเท่าไร "ก่อน" นับการมาถึงนี้เป็นการใช้งาน
    touch();
    if (KIOSK_CONFIG.experience && KIOSK_CONFIG.experience.wakeOnVisitor) bus.emit(EV.UI_ACTIVITY, { source: "visitor" });
    socket && socket.send({ type: "event", data: { kind: "visitor", name: "arrive", people: session.people } });
    greet(session.people, { arrival: true, quietMs });   // VISITOR_DETECTED = ไม่เห็นใครครบ absenceGreetMs แล้ว (หรือคนแรก) → ทักทันที
  });
  bus.on(EV.VISITOR_RETURNED, ({ session }) => {
    // คนเดิมเดินกลับมาในช่วงคูลดาวน์: นับว่ายังอยู่ (พักประกาศ) แต่ไม่ทักซ้ำ
    if (KIOSK_CONFIG.experience && KIOSK_CONFIG.experience.wakeOnVisitor) bus.emit(EV.UI_ACTIVITY, { source: "visitor" });
    S.visitor = session;
    $("app").dataset.person = "1";
  });
  bus.on(EV.VISITOR_JOINED, ({ session }) => { S.visitor = session; });
  bus.on(EV.VISITOR_LEFT, ({ session }) => {
    S.visitor = null;
    if (visionPop) visionPop.close("visitor");   // 24 พ.ย. 2569: ไม่มีคนหน้าจอ → ปิดป๊อปอัปของสิ่งที่กล้องเห็น
    S.greetPending = 0;
    clearTimeout(S.greetTimer);
    delete $("app").dataset.person;
    socket && socket.send({ type: "event", data: { kind: "visitor", name: "leave", duration_s: Math.round(session.durationMs / 1000) } });
    // ผู้เข้าชมออกไปแล้ว: รอสักครู่แล้วกลับมาประกาศข่าวที่พักไว้
    S.resumeAt = Date.now() + KIOSK_CONFIG.ui.resumeAnnounceAfterMs;
    setTimeout(drainQueue, KIOSK_CONFIG.ui.resumeAnnounceAfterMs + 200);
  });
  bus.on(EV.CAMERA_STATUS_CHANGED, ({ state, detail }) => {
    S.cam = state; S.camDetail = detail;
    if (state === "denied") toast(t("camDeniedHelp"), 7000);
    renderStatus();
    updateToolsSheet();
  });
  // ท่ามือ/ป้ายเป็นการใช้งานโดยตั้งใจ จึงปลุกหน้าจอ (ต่างจากการเดินผ่านกล้องเฉย ๆ)
  bus.on(EV.CAMERA_GESTURE, ({ name }) => { bus.emit(EV.UI_ACTIVITY, { source: "gesture" }); onGesture(name); });
  bus.on(EV.CAMERA_SIGN, ({ label, prob }) => { bus.emit(EV.UI_ACTIVITY, { source: "sign" }); onSign(label, prob); });
}

// ====================================================================== VORA NEXT Phase 1 — Spatial Experience
// Orchestrator คุม IDLE/ACTIVE/PRESENTATION ด้วยการสลับ class เท่านั้น: กล้อง WebSocket อวตาร ไม่ถูกสร้างใหม่หรือปิด
function startExperience() {
  const cfg = KIOSK_CONFIG.experience || {};
  orch = new ExperienceOrchestrator($("app"), bus, ui, { presentationIdleMs: cfg.presentationIdleMs });
  ui.extraBusy = () => orch.isPresenting();
  const narrate = (type, id) => { bus.emit(EV.AVATAR_HINT, { state: "pointing", ms: 2500 }); return openCard(type, id); };
  // Phase 3: Conversation Journey — ตัวเลือกทุกขั้นมาจาก API จริง เก็บเฉพาะสิ่งที่เลือกใน sessionStorage (มีอายุ)
  journey = new JourneyEngine({ ttlMs: cfg.journeyTtlMs || 600000 });
  journeyView = new JourneyView(journey, {
    query: (q) => ask(q, "text", { internal: true }),
    say: (text, gesture = "explain") => respond({ text, lang: S.lang, gesture, answered: true }, { record: false, user: true }),
    narrate, qr: (url) => qrSvg(url, 6), mobileUrl, t, cfg: () => S.cfg,
    applyOnline: () => { const a = S.cfg && S.cfg.apply_online && S.cfg.apply_online[S.lang === "en" ? "en" : "th"]; if (a && applyPop) applyPop.show(a, S.lang); },
    close: () => orch.close("journey-done"),
  });
  // Phase 4: Knowledge Constellation — กราฟจาก /api/constellation (ความสัมพันธ์ในฐานข้อมูลจริงเท่านั้น)
  constellation = new ConstellationView({ narrate, ask: (q) => ask(q, "text"), point: () => bus.emit(EV.AVATAR_HINT, { state: "pointing", ms: 1500 }),
    // 27 พ.ย. 2569: กล่องคำถามในแผนผังความรู้ → พูดคำตอบ (ข้อความจากฐานความรู้ที่อนุมัติแล้ว ไม่ผ่าน AI) · ออกจากกล่อง = หยุดพูด
    say: (text) => { touch(); if (annPop && annPop.open) annPop.close("user"); const tok = im.begin("conversation", { user: true }); if (!tok) return; speaker.stop(); act("explain"); speakAs(tok, text, S.lang); },
    stop: () => { if (S.state === "speaking") { speaker.stop(); } } });
  // Phase 5: Time Portal — ปฏิทินกิจกรรมจาก /api/timeline (ข่าวที่เผยแพร่จริง · วันที่/เวลา/สถานที่ตามที่เจ้าหน้าที่บันทึก)
  timePortal = new TimePortalView({
    say: (text, gesture = "point_screen") => respond({ text, lang: S.lang, gesture, answered: true }, { record: false, user: true }),
    qr: (url) => qrSvg(url, 6), mobileUrl, point: () => bus.emit(EV.AVATAR_HINT, { state: "pointing", ms: 1500 }),
  }, S.lang);
  present = new PresentationView($("present"), {
    actions: { ask: (q) => ask(q, "text"), narrate, cfg: () => S.cfg, t, qr: (url) => qrSvg(url, 4),   // 27 พ.ย.: คิวอาร์ลิงก์ในข่าว
      // 11 พ.ย. 2569: บรรยายสไลด์พรีเซนเทชันสาขา (ไม่บันทึกลงแชท · คืน true เมื่อพูดจบโดยไม่ถูกแทรก)
      say: (text) => respond({ text, lang: S.lang, gesture: "present", emotion: "happy", answered: true }, { record: false, user: true }),
      prefetch: (texts) => speaker && speaker.prefetch(texts, S.lang),
      openSection: (id) => bus.emit(EV.EXPERIENCE_OPEN, { section: id, source: "journey" }) },
    onClose: (reason) => orch.close(reason),
    lang: S.lang,
    journey: journeyView,
    constellation,
    timeline: timePortal,
  });
  // หมดอายุ Session ของเส้นทาง: เริ่มบทสนทนาใหม่ / โหมดนำเสนอหมดเวลา (ไม่มีคนใช้) / ผู้เข้าชมออกไปและไม่มีการแตะจอ 30 วิ
  bus.on(EV.EXPERIENCE_CLOSE, ({ reason }) => { if (reason === "timeout") journey.clear("timeout"); });
  bus.on(EV.VISITOR_LEFT, () => { if (journey.active && Date.now() - S.lastActivity > 30000) journey.clear("visitor-left"); });
  orch.attachView(present);
  orch.start();
  bus.on(EV.VISITOR_GREETED, onGreeted);
  if (cfg.orbitalMenu !== false) {
    // 8 พ.ย. 2569: ปุ่มหมวดชุดเดิมวางเป็นแถบเครื่องมือขอบซ้าย (ตามภาพ Reference) — kiosk-config.js → experience.menuLayout: "orbital" = กลับไปวางรอบอวตาร
    const rail = cfg.menuLayout !== "orbital" && $("railMenu");
    menu = new SpatialMenu($("stage"), $("avatar"), { onSelect: (s) => onSection(s, "orbit"), lang: S.lang, layout: rail ? "rail" : "orbital", mount: rail || null });
    $("app").classList.add("has-orbit");
  }
  bus.on(EV.UI_LANG, ({ lang }) => { menu && menu.setLang(lang); present.setLang(lang); renderTextMenu(); });
  bus.on(EV.EXPERIENCE_MODE, ({ mode, prev }) => {
    menu && menu.setCurrent(mode === "presentation" ? orch.section : null);
    // Phase 2: อวตารอยู่ในท่านำเสนอตลอดโหมดนำเสนอ (ไม่ทับการฟัง/คิด/ทักทาย/ประกาศ)
    // เปลี่ยนเฉพาะตอนเข้า/ออกโหมดนำเสนอ — สลับ Idle/Active ไม่ล้างสถานะชั่วคราว (เช่น thanking)
    if (mode === "presentation" || prev === "presentation") bus.emit(EV.AVATAR_HINT, { state: mode === "presentation" ? "presenting" : null });
  });
  $("textMenuBtn").onclick = () => { renderTextMenu(); $("textMenu").showModal(); };
  $("textMenuClose").onclick = () => $("textMenu").close();
  renderTextMenu();
}

// ====================================================================== เลย์เอาต์ตามภาพ Reference (8 พ.ย. 2569) — ปุ่มใหม่บนหน้าจอเท่านั้น
// ทุกปุ่มเรียกฟังก์ชันเดิม (ปิดการนำเสนอ/ลิ้นชัก, เต็มจอ) ไม่มีตรรกะ AI/เสียง/กล้องใหม่
function setEdgeOpen(open) {
  $("app").classList.toggle("edge-open", open);
  $("edgeHint").setAttribute("aria-expanded", String(open));
}

function setThemeChoice(theme) {
  if (!applyTheme(theme)) return;
  try { localStorage.setItem("vora.theme", theme); } catch { /* ignore */ }
  syncTheme(theme);
  document.querySelectorAll(".theme-opt").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === theme)));
}

function wireReferenceLayout() {
  $("homeBtn").onclick = () => {
    touch();
    if (orch && orch.isPresenting()) orch.close("home");
    closeDrawer();
    setEdgeOpen(false);
    menu && menu.setCurrent(null);
  };
  $("fsBtn").onclick = () => $("tFullscreen").click();
  $("edgeHint").onclick = () => { touch(); setEdgeOpen(!$("app").classList.contains("edge-open")); };
  $("edgeClose").onclick = () => { setEdgeOpen(false); $("edgeHint").focus(); };
  // แตะที่อื่นบนจอ = ปิดแผงขวา (แผงเปิดค้างจาก Focus ของปุ่มข้างใน จะไม่บังกล่องคำพูดหลังใช้งานเสร็จ)
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest("#rightPanel, #edgeHint, .edge-zone, dialog")) return;
    setEdgeOpen(false);
    if ($("rightPanel").contains(document.activeElement)) document.activeElement.blur();
  });
  document.querySelectorAll(".theme-opt").forEach((b) => (b.onclick = () => { touch(); setThemeChoice(b.dataset.theme); }));
  setThemeChoice(currentTheme() || "dark");
}

/** หมวดจาก Orbital Menu / เมนูตัวอักษรใหญ่ */
function onSection(section, source) {
  touch();
  socket && socket.send({ type: "event", data: { kind: "menu", name: section.id, source } });
  if (section.action === "present") { bus.emit(EV.EXPERIENCE_OPEN, { section: section.id, source }); return; }
  orch.close("menu");        // ผู้ช่วย AI / ความคิดเห็น ใช้แผงสนทนาและหน้าต่างเดิม
  onNav(section.action === "ask" ? "ask" : "rate");
}

function renderTextMenu() {
  const list = $("textMenuList");
  if (!list) return;
  list.innerHTML = SECTIONS.map((s) => `<button type="button" class="text-item" data-section="${s.id}"><b>${esc(s[S.lang] || s.th)}</b><span>${esc(S.lang === "en" ? s.hintEn : s.hintTh)}</span></button>`).join("");
  list.querySelectorAll("[data-section]").forEach((b) => (b.onclick = () => {
    $("textMenu").close();
    onSection(SECTIONS.find((s) => s.id === b.dataset.section), "text-menu");
  }));
}

// ====================================================================== VORA NEXT Phase 2 — Privacy Pause + Smart Greeting
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

async function togglePrivacy() {
  if (!cam || !["on", "paused"].includes(S.cam)) return;
  touch();
  const paused = await cam.privacyToggle(((KIOSK_CONFIG.camera && KIOSK_CONFIG.camera.privacyPauseMs) || 300000));
  toast(paused ? `${t("privacyPaused")} ${mmss(cam.pausedUntil - Date.now())}` : t("privacyResumed"));
  socket && socket.send({ type: "event", data: { kind: "privacy", name: paused ? "pause" : "resume" } });
  renderStatus();
}

/** ป้ายกล้อง: หัวจอ (โหมดใช้งาน) + ป้ายลอยมุมซ้ายล่าง (โหมดว่าง) — ผู้เข้าชมเห็นสถานะกล้องได้ทุกโหมด */
function renderPrivacy() {
  const paused = S.cam === "paused";
  const left = paused && cam ? mmss(cam.pausedUntil - Date.now()) : "";
  const canToggle = S.cam === "on" || paused;
  $("camPill").setAttribute("aria-pressed", String(paused));
  $("camPill").title = canToggle ? (paused ? t("camTapResume") : t("camTapPause")) : t("camLabel");
  $("camPill").classList.toggle("paused", paused);
  if (paused) $("camSub").textContent = t("resumeIn")(left);
  const b = $("camBadge");
  b.hidden = !canToggle;
  b.classList.toggle("paused", paused);
  b.querySelector(".cb-t").textContent = paused ? `${t("camPaused")} · ${t("resumeIn")(left)}` : t("camBadgeOn");
  b.querySelector(".cb-a").textContent = paused ? t("camTapResume") : t("camTapPause");
  b.setAttribute("aria-label", `${b.querySelector(".cb-t").textContent} — ${b.querySelector(".cb-a").textContent}`);
}

/** หลังทักทาย: แนะนำหมวดจากข้อมูลจริง (มีข่าวรับสมัครที่เผยแพร่ → รับสมัคร + สาขา, ไม่มี → สาขา + ข่าว) */
async function suggestAfterGreeting() {
  let ids = ["departments", "news"];
  try {
    if (!S.newsKindsAt || Date.now() - S.newsKindsAt > 60000) {
      const items = await api(`/api/news?limit=20&lang=${S.lang}`);
      S.newsKinds = items.map((n) => n.kind); S.newsKindsAt = Date.now();
    }
    if ((S.newsKinds || []).includes("admission")) ids = ["admission", "departments"];
  } catch { /* ใช้ค่าเริ่มต้น */ }
  bus.emit(EV.VISITOR_GREETED, { session: S.visitor, suggest: ids });
}

function onGreeted({ suggest }) {
  const ms = 12000;
  menu && menu.highlight(suggest, ms);
  const names = suggest.map((id) => { const s = SECTIONS.find((x) => x.id === id); return s ? s[S.lang] || s.th : id; }).join(" · ");
  const hint = $("idleHint").querySelector("span:last-child");
  if (!hint) return;
  hint.textContent = t("suggestTap")(names);
  clearTimeout(S.suggestTimer);
  S.suggestTimer = setTimeout(() => { hint.textContent = hint.dataset[S.lang] || hint.dataset.th; }, ms);
}

function startCamera() {
  cam = new CameraVisitorController(bus, $("camVideo"), {
    visitor: KIOSK_CONFIG.visitor, camera: KIOSK_CONFIG.camera,
    // "คนเดิมกลับมา" = ไม่เห็นใครสั้นกว่า absenceGreetMs แล้วกลับมา (ไม่ใช้การจดจำใบหน้า ใช้ช่วงเวลาเท่านั้น)
    returnWindowMs: () => returnWindowMs({ absenceGreetMs: KIOSK_CONFIG.visitor.absenceGreetMs ?? 8000, leaveMs: KIOSK_CONFIG.visitor.leaveMs }),   // 16 พ.ย. 2569: ไม่เห็นใครครบ 8 วิ = คนใหม่ (เดิม min(คูลดาวน์, 8 วิ) นับหลัง Session จบ)
  });
  wireCameraEvents();
  cam.start();
}

// ====================================================================== ความพึงพอใจ
let rating = 0;
function openRating(force = false) {
  if (S.rated && !force) return;
  if ($("rateSheet").open) return;
  S.rated = true;
  rating = 0;
  const stars = $("stars");
  stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
    const b = document.createElement("button");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.setAttribute("aria-label", `${n}`);
    b.textContent = ["😞", "🙁", "😐", "🙂", "😍"][n - 1];
    b.onclick = () => {
      rating = n;
      stars.querySelectorAll("button").forEach((x, i) => x.setAttribute("aria-checked", String(i === n - 1)));
      $("rateSend").disabled = false;
    };
    return b;
  }));
  $("rateComment").value = "";
  $("rateSend").disabled = true;
  $("rateSheet").showModal();
  clearTimeout(openRating.timer);
  openRating.timer = setTimeout(() => $("rateSheet").open && $("rateSheet").close(), 30000);
}

async function sendRating() {
  try {
    await api("/api/feedback", { method: "POST", body: { session_id: S.sessionId || "", kind: "rating", rating, comment: $("rateComment").value } });
    toast(t("rateThanks"));
    emote("happy"); act("bow"); flashHappy();
    bus.emit(EV.AVATAR_HINT, { state: "thanking", ms: 2600 });   // Phase 2: สถานะขอบคุณ
  } catch (e) { toast(e.message); }
  $("rateSheet").close();
}

// ====================================================================== สถานะระบบ (ทุกค่ามาจากระบบจริง)
async function pollHealth() {
  try {
    S.health = await api("/api/health", { timeout: 6000 });
    S.healthErr = false;
    if (S.health.robot && !S.robotFromWs) S.robot = { ...(S.robot || {}), ...S.health.robot };
    updateNetMode(netModeOf(S.health));
  } catch {
    S.health = null; S.healthErr = true;
  }
  renderStatus();
  syncAvatar();
}

/** งาน F: โหมดฐานความรู้ — เปลี่ยนโหมดเมื่อเซิร์ฟเวอร์แจ้ง (ทุก 15 วิ) · แจ้งผู้ใช้ครั้งเดียวต่อการเปลี่ยน */
async function loadQuick() {
  try { S.quick = (await api(`/api/quick-questions?lang=${S.lang}`, { timeout: 5000 })).questions || []; } catch { /* ใช้รายการเดิม */ }
}
async function updateNetMode(mode) {
  const change = netTransition(S.net, mode);
  S.net = mode;
  if (!change) return;
  if (change === "offline") { await loadQuick(); toast(t("netOffline"), 7000); }
  else toast(t("netBack"), 4000);
  renderChips();
}

async function checkMic() {
  if (!listener.supported) { S.mic = "unsupported"; renderStatus(); return; }
  let perm = "prompt";
  // ขอสถานะสิทธิ์ครั้งเดียวแล้วใช้ตัวเดิม (เดิมสร้าง PermissionStatus + onchange ใหม่ทุกครั้งที่เรียก → ตัวฟังซ้อนเพิ่มขึ้นเรื่อย ๆ)
  try {
    if (!S.micPerm) { S.micPerm = await navigator.permissions.query({ name: "microphone" }); S.micPerm.onchange = () => checkMic(); }
    perm = S.micPerm.state;
  } catch { /* ignore */ }
  let has = true;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    has = devs.some((d) => d.kind === "audioinput");
  } catch { /* ignore */ }
  S.mic = !has ? "none" : perm === "denied" ? "denied" : perm === "granted" ? "ready" : "prompt";
  renderStatus();
}

function camLabel(s) {
  return ({ on: t("camOn"), loading: t("camLoading"), requesting: t("camRequest"), denied: t("camDenied"), "not-found": t("camNotFound"),
    "in-use": t("camInUse"), lost: t("camLost"), error: t("camError"), "model-error": t("camModel"), "staff-off": t("camStaffOff"),
    unsupported: t("camUnsupported"), idle: t("camLoading"), paused: t("camPaused") })[s] || s;
}

function setRow(k, cls, text) {
  const li = $("statusList").querySelector(`[data-k="${k}"]`);
  li.className = cls;
  li.querySelector(".val").textContent = text;
  li.querySelector(".val").title = text;
}

function renderStatus() {
  const h = S.health;
  // AI
  if (!h) setRow("ai", S.healthErr ? "bad" : "", S.healthErr ? t("aiOffline") : "…");
  else if (h.ai && h.ai.ready) {
    const llm = h.ai.llm_provider && h.ai.llm_provider !== "offline" ? h.ai.llm_provider : "";
    setRow("ai", h.ai.llm_circuit_open ? "warn" : "ok", t("aiReady")(h.ai.intent_model, llm));
  } else setRow("ai", "warn", t("aiNoModel"));
  // Database
  if (!h) setRow("db", S.healthErr ? "bad" : "", S.healthErr ? t("dbBad") : "…");
  else if (h.db) setRow("db", h.db.ok ? "ok" : "bad", h.db.ok ? t("dbOk")(h.db.engine === "postgresql" ? "PostgreSQL" : "SQLite") : t("dbBad"));
  else setRow("db", "warn", "?");
  // Camera
  const camCls = S.cam === "on" ? "ok" : ["denied", "not-found", "error", "model-error", "unsupported"].includes(S.cam) ? "bad" : ["staff-off", "lost", "in-use"].includes(S.cam) ? "warn" : "";
  let camTxt = camLabel(S.cam);
  if (cam && cam.retryAt && ["lost", "not-found", "in-use", "error"].includes(S.cam)) {
    const s = Math.max(0, Math.round((cam.retryAt - Date.now()) / 1000));
    if (s > 0) camTxt += ` · ${t("retryIn")(s)}`;
  }
  setRow("cam", camCls, camTxt);
  $("camDot").className = "dot rec " + (camCls || "");
  $("camText").textContent = t("camLabel");
  $("camSub").textContent = camLabel(S.cam);
  renderPrivacy();
  // Microphone
  const micMap = { ready: ["ok", t("micReady")], prompt: ["warn", t("micAsk")], denied: ["bad", t("micDenied2")], none: ["bad", t("micNone")], unsupported: ["bad", t("micNoSupport")], unknown: ["", "…"] };
  const [mc, mt] = S.state === "listening" ? ["ok", t("micListening")] : micMap[S.mic] || micMap.unknown;
  setRow("mic", mc, mt);
  // Robot
  const r = S.robot;
  if (!r || (!S.wsOnline && !h)) setRow("robot", S.healthErr ? "bad" : "", S.healthErr ? t("robotOff") : "…");
  else if (r.estop) setRow("robot", "bad", t("robotEstop"));
  else if (r.connected && r.ready) setRow("robot", "ok", (r.driver === "simulator" ? t("robotSim") : t("robotReady")) + (r.battery != null && r.driver !== "simulator" ? t("robotBatt")(Math.round(r.battery)) : ""));
  else if (r.connected) setRow("robot", "warn", t("robotNotReady"));
  else setRow("robot", "bad", t("robotOff"));

  // งาน F: อินเทอร์เน็ต / โหมด AI
  const kb = S.net === "kb";
  if (h && h.net) setRow("net", kb ? "warn" : "ok", kb ? (h.net.forced ? t("netRowForced") : t("netRowKb")) : t("netRowAi"));
  else setRow("net", S.healthErr ? "bad" : "", "…");

  // ภาพรวมที่หัวจอ: "พร้อมใช้งาน" เฉพาะเมื่อเซิร์ฟเวอร์ + WebSocket + ฐานข้อมูล + AI พร้อมจริง
  const pill = $("sysPill");
  let cls = "", txt = t("sysCheck");
  if (S.healthErr && !S.wsOnline) { cls = "bad"; txt = t("sysOff"); }
  else if (r && r.estop) { cls = "bad"; txt = t("sysEstop"); }
  else if (h) {
    const core = S.wsOnline && h.db && h.db.ok && h.ai && h.ai.ready;
    cls = core ? "ok" : "warn"; txt = core ? t("sysOk") : t("sysPartial");
    if (core && kb) { cls = "warn"; txt = t("sysKb"); }      // งาน F: ใช้งานได้ แต่ตอบจากฐานความรู้ (ไม่มีอินเทอร์เน็ต)
  }
  pill.className = "pill sys " + cls;
  $("sysDot").className = "dot " + cls;
  $("sysText").textContent = txt;
  $("sysSub").textContent = !S.wsOnline ? "VORA Offline" : h && h.net ? (kb ? t("netKbSub") : t("netAiSub")) : "VORA Online";
}

function onSocket(topic, data) {
  if (topic === "hello" || topic === "robot.status") { S.robot = data.robot || data; S.robotFromWs = true; renderStatus(); syncAvatar(); }
  else if (topic === "announce") enqueue(data);
  else if (topic === "say") enqueue({ kind: "text", text_th: data.text, text_en: data.text, priority: prOnly() ? 5 : 4 });
  else if (topic === "robot.event" && data.name === "obstacle_detected") act("shake");
}

// ====================================================================== นาฬิกา, QR, เครื่องมือ
function renderClock() {
  const d = new Date();
  const loc = S.lang === "en" ? "en-GB" : "th-TH";
  $("clockTime").textContent = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  $("clockDate").textContent = d.toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
}

function mobileUrl() { return (S.cfg && S.cfg.mobile_url) || `${location.origin}/m/`; }
/** 25 พ.ย. 2569: ขอที่อยู่หน้ามือถือล่าสุดจากเซิร์ฟเวอร์ (เครื่องหลักเปลี่ยนเครือข่าย → คิวอาร์ถูกต้องโดยไม่ต้องรีเฟรช) */
async function refreshMobileUrl() {
  try {
    const r = await api("/api/kiosk/mobile_url", { timeout: 4000 });
    if (S.cfg && r && r.url) { S.cfg.mobile_url = r.url; S.cfg.mobile_ok = r.ok; S.cfg.mobile_warning = r.warning || ""; }
    if ($("qrMini") && S.cfg) $("qrMini").innerHTML = S.cfg.mobile_ok === false ? "" : qrSvg(mobileUrl(), 4);
  } catch { /* ใช้ค่าเดิม */ }
}
/** 25 พ.ย. 2569: บอกเซิร์ฟเวอร์ว่าหน้าจอหุ่นยนต์ใช้ธีมไหน → หน้ามือถือใช้ธีมเดียวกัน (เซิร์ฟเวอร์รับเฉพาะเครื่องบนตัวหุ่นยนต์) */
function syncTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  if (S.cfg && S.cfg.theme === theme) return;
  api("/api/kiosk/theme", { method: "POST", body: { theme } }).then(() => { if (S.cfg) S.cfg.theme = theme; }).catch(() => {});
}
function qrSvg(url, cell) {
  try { const qr = qrcode(0, "M"); qr.addData(url); qr.make(); return qr.createSvgTag({ cellSize: cell, margin: 1, scalable: true }); }
  catch { return ""; }
}

function updateToolsSheet() {
  if (!$("toolsSheet").open) return;
  $("camStaffText").textContent = S.cam === "denied" ? `${t("camStaff")} ${t("camDeniedHelp")}` : t("camStaff");
  const snap = cam ? cam.snapshot() : { session: null, tracks: [] };
  const ago = S.lastGreetAt ? t("secAgo")(Math.round((Date.now() - S.lastGreetAt) / 1000)) : t("none");
  const rows = [
    [t("dCam"), camLabel(S.cam)],
    [t("dSession"), snap.session ? `${snap.session.id} · ${t("people")(snap.session.people)}` : t("none")],
    [t("dTracks"), snap.tracks.length ? snap.tracks.map((x) => x.id + (x.confirmed ? "" : "?")).join(", ") : t("none")],
    [t("dLastGreet"), ago],
    [t("dActivity"), t("act")[im.kind] || im.kind],
    [t("dUi"), ui ? (ui.mode === "idle" ? t("uiIdle") : t("uiActive")) : t("none")],
    [t("dVoice"), `${S.mic} · ${listener && listener.supported ? "Web Speech" : "—"} · ${window.isSecureContext ? "secure" : "NOT secure"} · rec ${listener ? listener.stats.created : 0}`],
    [t("dVoiceErr"), S.voiceError ? `${S.voiceError.code} · ${t("secAgo")(Math.round((Date.now() - S.voiceError.at) / 1000))}` : t("none")],
    [t("dTts"), S.cfg && S.cfg.tts ? `${speaker && speaker.serverTTS ? t("ttsServer") : t("ttsBrowser")} · ${S.cfg.tts.voice_th}${S.cfg.tts.voice_en !== S.cfg.tts.voice_th ? " / " + S.cfg.tts.voice_en : ""} · ${S.cfg.tts.rate}${speaker && speaker.lastPath ? " · " + speaker.lastPath : ""}` : t("ttsBrowser")],
  ];
  $("diag").innerHTML = rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("");
  const off = S.cam === "staff-off";
  $("tCamToggle").textContent = off ? t("camOn2") : t("camOff");
  $("tCamToggle").classList.toggle("enable", off);
  $("tPanels").textContent = t("hidePanels");
}

// ====================================================================== เริ่มระบบ
async function init() {
  initScreenLink().catch(() => {});                 // 25 พ.ย. 2569: เปิดจากเครื่องอื่น → ขออนุมัติจากหลังบ้าน (เครื่องหลักไม่ทำอะไร)
  // Controller 1: Avatar — สร้างจากของเดิม แล้วเชื่อมกับ Event กลาง
  avatar = await createAvatar($("avatar"), KIOSK_CONFIG.avatar);
  avatar.connect(bus, { app: $("app"), stage: $("stage"), box: $("avatar"), bubble: $("bubble"), caption: $("caption"), stateText: $("stateText") },
    { focusScale: KIOSK_CONFIG.ui.focusScale, focusFit: KIOSK_CONFIG.ui.focusFit });
  // เอฟเฟกต์ด้านหลังอวตาร (ชั้นแสดงผลเท่านั้น รับระดับเสียงจาก Event เดิม AVATAR_MOUTH) — ปิดได้ที่ kiosk-config.js → ui.holoEffects
  if (KIOSK_CONFIG.ui.holoEffects !== false) {
    const holo = new HoloCore($("stage").querySelector(".holo"), bus);
    if (KIOSK_CONFIG.ui.holoEffects !== "full") holo.autoLite();   // เครื่องช้า → โหมดเบาอัตโนมัติ
  }
  // Controller 2: UI — โหมด Idle/Active (อวตารรับ UI_IDLE/UI_ACTIVE ไปขยาย/ย่อเอง)
  ui = new UIController($("app"), bus, { idleAfterMs: KIOSK_CONFIG.ui.idleAfterMs, idleHint: KIOSK_CONFIG.ui.idleHint });
  ui.start();
  startExperience();
  sitePop = new SitePopup(document.body, { qr: (url) => qrSvg(url, 6) });
  aboutPop = new AboutPopup(document.body, { qr: (url) => qrSvg(url, 5) });
  applyPop = new ApplyOnlinePopup(document.body, { qr: (url) => qrSvg(url, 6),
    say: (text) => respond({ text, lang: S.lang, gesture: "explain", emotion: "happy", answered: true }, { record: false, user: true }) });
  annPop = new AnnouncePopup(document.body, { onClose: () => { if (S.phase === "attract") nextPromo(false); } });
  visionPop = new VisionPopup(document.body, { qr: (url) => qrSvg(url, 6), ask: (q) => ask(q, "text") },
    { idleMs: (KIOSK_CONFIG.vision && KIOSK_CONFIG.vision.popupIdleMs) || 60000 });
  webPop = new WebPopup(document.body, {
    feedback: (rating, d) => api("/api/feedback", { method: "POST", body: { session_id: S.sessionId || "", message_id: d.messageId || null,
      kind: rating > 0 ? "thumb" : "wrong_answer", rating, comment: `web: ${(d.query || "").slice(0, 200)}` } }),
    onAnswered: (rating) => {
      emote(rating > 0 ? "happy" : "sorry");
      respond({ text: S.lang === "en" ? (rating > 0 ? "Thank you! Glad it helped." : "Thank you. I've noted it so the staff can check.")
        : (rating > 0 ? "ขอบคุณค่ะ ดีใจที่ข้อมูลมีประโยชน์นะคะ" : "ขอบคุณค่ะ หนูบันทึกไว้ให้เจ้าหน้าที่ตรวจสอบแล้วนะคะ"), lang: S.lang, gesture: rating > 0 ? "happy" : "nod", answered: true }, { record: false, user: true });
    },
  });
  speaker = new Speaker({ onLevel: (l) => bus.emit(EV.AVATAR_MOUTH, l), onAudio: (on) => bus.emit(EV.AVATAR_AUDIO, { on }) });
  listener = new Listener({
    onAudioStart: () => { if (S.state === "listening") { setVoice("live"); setCaption(t("vLive"), true); } },
    onSpeechEnd: () => { if (S.state === "listening") { setVoice("transcribing"); if (!S.partial) setCaption(t("vTranscribing"), true); } },
    onPartial: (txt) => { S.partial = txt; if (S.state === "listening") { if ($("app").dataset.voice === "starting") setVoice("live"); setCaption(txt || "…", true); } },
    onFinal: (txt) => { S.partial = ""; setVoice(""); if (onGuideVoice(txt)) return; if (parseVoiceCommand(txt) === "STOP_SPEAKING") { stopSpeaking(); return; } ask(txt, "voice"); },
    onError: (code) => { S.partial = ""; onVoiceError(code); },
    onEnd: () => { S.partial = ""; if (S.state === "listening") onVoiceError("no-speech"); },
  });
  try { S.lang = localStorage.getItem("vora.lang") || "th"; } catch { /* ignore */ }

  applyLang();
  renderClock();
  setInterval(renderClock, 10000);
  socket = new LiveSocket("kiosk", { onMessage: onSocket, onStatus: (on) => { S.wsOnline = on; renderStatus(); syncAvatar(); } });
  pollHealth();
  setInterval(pollHealth, KIOSK_CONFIG.ui.healthPollMs);
  checkMic();
  // Controller 3: Camera & Visitor — กล้องเริ่มทันที ไม่ต้องรอให้ผู้ใช้กด (ถ้าเบราว์เซอร์อนุญาตแล้ว) และทำงานต่อเนื่องทุกโหมด
  startCamera();

  // ความมีชีวิตชีวาของอวตาร: ?motion= ใน URL ใช้ทันที (ไม่ต้องรอเซิร์ฟเวอร์) · ไม่มี = รอค่าจากหลังบ้านด้านล่าง
  const motionQ = new URLSearchParams(location.search).get("motion");
  if (motionQ != null && avatar && avatar.setMotionLevel) avatar.setMotionLevel(Number(motionQ));
  for (let i = 0; i < 30; i++) {
    try { S.cfg = await api("/api/kiosk/config"); break; } catch { await sleep(2000); }
  }
  // 25 พ.ย. 2569: ธีมของหน้าจอนี้ → หน้ามือถือ · ที่อยู่คิวอาร์อัปเดตทุก 60 วินาที (เปลี่ยนเครือข่ายแล้วคิวอาร์ไม่ค้าง IP เดิม)
  if (S.cfg) { syncTheme(document.documentElement.getAttribute("data-vora-theme")); setInterval(refreshMobileUrl, 60000); }
  setInterval(async () => {
    try { const c = await api("/api/kiosk/config"); if (S.cfg && c) Object.assign(S.cfg, { idle_mode: c.idle_mode, quiet_hours: c.quiet_hours, pr_schedule_only: c.pr_schedule_only }); }
    catch { /* ignore */ }
    if (S.cfg && S.cfg.idle_mode !== "rotate") hidePromoCard();
  }, 60000);
  if (S.cfg) {
    speaker.serverTTS = !!S.cfg.server_tts;
    speaker.rate = S.cfg.voice_rate || 1;
    speaker.order = (S.cfg.tts && Array.isArray(S.cfg.tts.order)) ? S.cfg.tts.order : [];   // Phase 4: ลำดับผู้ให้บริการสำหรับล็อกเสียงต่อคำตอบ
    if (!S.cfg.languages.includes(S.lang)) S.lang = "th";
    $("qrMini").innerHTML = qrSvg(mobileUrl(), 4);
  }
  // 19 พ.ย. 2569: ความมีชีวิตชีวาของอวตาร (หลังบ้าน → ตั้งค่า) · ?motion=0–200 ใน URL มีผลก่อน (ใช้ทดสอบ)
  if (motionQ == null && S.cfg && S.cfg.avatar_motion != null) avatar && avatar.setMotionLevel && avatar.setMotionLevel(S.cfg.avatar_motion);
  applyLang();
  resetSession();

  // ปุ่มและคีย์ลัด
  $("micBtn").onclick = startListening;
  $("askForm").onsubmit = (e) => { e.preventDefault(); const v = $("askInput").value; $("askInput").value = ""; $("askInput").blur(); ask(v, "text"); };
  $("stopBtn").onclick = () => stopAll();
  document.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => onNav(b.dataset.nav)));
  document.querySelectorAll("[data-ask]").forEach((b) => (b.onclick = () => ask(S.lang === "en" ? b.dataset.askEn : b.dataset.ask, "text")));
  $("drawerClose").onclick = closeDrawer;
  $("qrBtn").onclick = async () => {
    touch();
    await refreshMobileUrl();            // 25 พ.ย. 2569: ที่อยู่ล่าสุดทุกครั้งที่เปิด
    const url = mobileUrl();
    if (S.cfg && S.cfg.mobile_ok === false) {
      $("qrUrl").textContent = S.cfg.mobile_warning || url;
      $("qrBox").innerHTML = `<p class="qr-warn">⚠️ ${esc(S.lang === "en" ? "This screen is not on a LAN yet, so phones cannot open the link. Connect the main PC to Wi-Fi/LAN and try again." : (S.cfg.mobile_warning || "ยังไม่ได้เชื่อมต่อเครือข่าย"))}</p>`;
    } else {
      $("qrUrl").textContent = url;
      $("qrBox").innerHTML = qrSvg(url, 6) || esc(url);
    }
    $("qrSheet").showModal();
  };
  $("qrClose").onclick = () => $("qrSheet").close();
  $("rateSkip").onclick = () => $("rateSheet").close();
  $("rateSend").onclick = sendRating;
  document.querySelectorAll(".lang button").forEach((b) => (b.onclick = () => {
    S.lang = b.dataset.lang;
    try { localStorage.setItem("vora.lang", S.lang); } catch { /* ignore */ }
    applyLang();
    if (S.net === "kb") loadQuick().then(() => renderChips());   // งาน F: คำถามยอดฮิตตามภาษาที่เลือก
    touch();
  }));
  $("camBtn").onclick = () => {
    const show = !$("camPreview").classList.contains("show");
    $("camPreview").classList.toggle("show", show);
    $("camBtn").setAttribute("aria-pressed", String(show));
    if (show && S.cam !== "on" && S.cam !== "staff-off") cam.retry();   // แตะปุ่มช่วยให้เบราว์เซอร์ขอสิทธิ์ได้
    if (show && S.cam === "staff-off") toast(t("camStaffOff"));
  };
  // Phase 2: แตะป้ายกล้อง = พัก/เปิดกล้อง (Privacy Pause ของผู้เข้าชม) · สถานะอื่น (ไม่ได้รับอนุญาต/เจ้าหน้าที่ปิด ฯลฯ) เปิดแผงเครื่องมือเหมือนเดิม
  $("camPill").onclick = () => { if (S.cam === "on" || S.cam === "paused") togglePrivacy(); else $("toolsBtn").click(); };
  $("camBadge").onclick = () => togglePrivacy();
  $("gestureBtn").onclick = () => {
    const show = $("gesturePop").hidden;
    $("gesturePop").hidden = !show;
    $("gestureBtn").setAttribute("aria-pressed", String(show));
  };
  $("toolsBtn").onclick = () => { $("toolsSheet").showModal(); updateToolsSheet(); };
  $("toolsClose").onclick = () => $("toolsSheet").close();
  $("tPanels").onclick = () => { $("toolsSheet").close(); ui.goIdle(); };   // เข้าโหมดว่าง (Avatar Focus) ทันที
  $("tFullscreen").onclick = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); };
  wireReferenceLayout();
  // 17 พ.ย. 2569: VORA Guide — พูดผ่าน respond() เดิม (ไม่บันทึกเป็นบทสนทนา) · ไม่สั่งหุ่นยนต์ · ปิดใช้ระหว่างโหมดนำเสนอ
  guide = new VoraGuide({
    bus, EV, button: $("vgBtn"),
    getLang: () => S.lang,
    speak: (text, lang) => respond({ text, lang, answered: true }, { record: false, user: true }),
    stopSpeech: () => speaker.stop(),
    clearCaption: (text) => { if (avatar.bubbleText === text) setCaption(""); },
    isPresenting: () => !!(orch && orch.isPresenting()),
    onStart: () => { touch(); listener.stop(true); if (S.state === "listening") setState("idle"); },
    keepAlive: touch,   // ระหว่าง Guide: กติกาเดิมของการทักทาย/รีเซ็ตเซสชันเห็นว่ามีผู้ใช้งานอยู่
  });
  $("vgBtn").onclick = () => { touch(); guide.start("button"); };
  $("tGreet").onclick = () => { $("toolsSheet").close(); if (S.phase !== "attract") resetSession(); greet(1, { force: true }); };
  $("tReset").onclick = () => { $("toolsSheet").close(); stopAll({ quiet: false }); resetSession(); };
  $("tCamToggle").onclick = async () => { await cam.staffToggle(); updateToolsSheet(); };
  // ทดสอบเสียง VORA: พูดตัวอย่างไทย / ไทยปนอังกฤษ / อังกฤษ ผ่านเส้นทางจริง (Speaker → อวตารพูด) ไม่บันทึกเป็นบทสนทนา
  $("tVoice").onclick = () => {
    $("toolsSheet").close();
    S.voiceSample = ((S.voiceSample || 0) % 3) + 1;
    const text = t("voiceSamples")[S.voiceSample - 1];
    const lang = /^[\x00-\x7F\s]+$/.test(text) ? "en" : "th";
    respond({ text, lang, gesture: "explain", answered: true }, { record: false, user: true });
  };
  setInterval(() => { updateToolsSheet(); if ((cam && cam.retryAt) || S.cam === "paused") renderStatus(); }, 1000);
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    // Space บนปุ่มที่โฟกัสอยู่ = กดปุ่มนั้น (Keyboard Navigation ของเมนู) ไม่ใช่คีย์ลัดเริ่มฟัง
    if (e.code === "Space" && !(e.target.closest && e.target.closest("button, a, dialog"))) { e.preventDefault(); startListening(); }
    if (e.key === "Escape") stopAll();
  });
  document.addEventListener("pointerdown", touch);

  // วงรอบ: หมุนเวียนสื่อประชาสัมพันธ์ จบเซสชันเมื่อผู้ใช้เดินจากไป และพูดประชาสัมพันธ์เมื่อว่าง
  setInterval(() => {
    const idleFor = (Date.now() - S.lastActivity) / 1000;
    if (S.state !== "idle") return;
    if (S.phase === "attract" && prOnly()) {
      nextPromo(false);
      drainQueue();
    } else if (S.phase === "attract") {
      nextPromo(false);
      const every = (S.cfg && S.cfg.idle_attract_s) || 90;
      if (S.cfg && S.cfg.attract_mode && !S.visitor && !inQuietHours(S.cfg.quiet_hours) && (Date.now() - S.lastAttractSpeak) / 1000 > every && idleFor > 20) {
        S.lastAttractSpeak = Date.now();
        enqueue({ ...(S.currentPromo || {}), priority: 1 });
      }
      drainQueue();
    } else if (prOnly() && S.queue.length && idleFor > 45 && S.visitor) {
      drainQueue();
    } else if (idleFor > 45 && !S.visitor && !$("rateSheet").open) {
      if (S.questions >= 2 && !S.rated) { openRating(); S.lastActivity = Date.now() - 30000; }
      else resetSession();
    } else if (idleFor > 150) {
      resetSession();
    }
  }, 12000);

  if (DEBUG) {
    bus.debug = true;
    // ใช้ทดสอบเท่านั้น (?debug=1): ป้อนกล่องใบหน้าจำลองเข้าตัวติดตามจริง เพื่อทดสอบลำดับการทักทายโดยไม่ต้องมีคนจริง
    window.VORA = {
      S, im, bus, ui, cam, orch, present, menu, journey, journeyView, constellation, timePortal, config: KIOSK_CONFIG, get tracker() { return cam.tracker; }, get camera() { return cam.camera; }, avatar, speaker, listener, enqueue, onGesture, greet, onSocket,
      async simulateVisitor(ms = 3000, boxes = [{ x: 0.4, y: 0.3, w: 0.2, h: 0.26 }]) {
        const end = performance.now() + ms;
        while (performance.now() < end) { cam.tracker.update(boxes, performance.now()); await sleep(270); }
      },
      async simulateEmpty(ms = 1000) {
        const end = performance.now() + ms;
        while (performance.now() < end) { cam.tracker.update([], performance.now()); await sleep(270); }
      },
    };
  }
}

init();
