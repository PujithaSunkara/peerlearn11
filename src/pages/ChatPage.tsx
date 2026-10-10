import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import AgoraRTC, {
  IAgoraRTCClient,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng';
import {
  Send,
  Code2,
  MessageSquare,
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  PhoneCall,
  FileText,
  Star,
  CheckCircle2,
  BookOpen,
  ArrowRight,
  Bot,
} from 'lucide-react';
import { api, TOKEN_STORAGE_KEY } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  ChatMessageItem,
  LearningSessionItem,
  SessionSummaryItem,
} from '../types';

// Generate a synthetic audio/video MediaStream if running in a headless/sandbox browser without a physical webcam
function createSyntheticMediaStream(userName: string): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');

  let frame = 0;
  const drawFrame = () => {
    if (!ctx) return;
    frame += 1;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Animated pulse ring
    const radius = 55 + Math.sin(frame * 0.08) * 6;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2 - 15, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#1d4ed8';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(userName || 'Peer Student', canvas.width / 2, canvas.height / 2 - 8);

    ctx.fillStyle = '#93c5fd';
    ctx.font = '14px monospace';
    ctx.fillText('LIVE 1-ON-1 WEBRTC STREAM', canvas.width / 2, canvas.height / 2 + 65);
  };

  drawFrame();
  const intervalId = window.setInterval(drawFrame, 100);
  const stream = canvas.captureStream(15);
  stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => window.clearInterval(intervalId));
  });
  return stream;
}

export function ChatPage() {
  const { user, refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');

  const [sessions, setSessions] = useState<LearningSessionItem[]>([]);
  const [activeSession, setActiveSession] =
    useState<LearningSessionItem | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [summaries, setSummaries] = useState<SessionSummaryItem[]>([]);
  const [sharedNotes, setSharedNotes] = useState('');

  // Chat composer
  const [inputContent, setInputContent] = useState('');
  const [messageType, setMessageType] = useState<'text' | 'code'>('text');
  const [codeLanguage, setCodeLanguage] = useState('python');
  const [socketConnected, setSocketConnected] = useState(false);

  // 1-on-1 Video Call State
  const [inVideoCall, setInVideoCall] = useState(false);
  const [incomingCallFrom, setIncomingCallFrom] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [videoNotice, setVideoNotice] = useState('');
  const [remoteConnected, setRemoteConnected] = useState(false);

  // Post-Video AI Summary & Listener Review/Rating State
  const [rating, setRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState('');
  const [completingSession, setCompletingSession] = useState(false);
  const [reviewSuccessBanner, setReviewSuccessBanner] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const agoraClientRef = useRef<IAgoraRTCClient | null>(null);
  const agoraTracksRef = useRef<{
    videoTrack: ICameraVideoTrack | null;
    audioTrack: IMicrophoneAudioTrack | null;
  }>({ videoTrack: null, audioTrack: null });

  // Load sessions
  useEffect(() => {
    api
      .get('/learning/sessions')
      .then((res) => {
        const list: LearningSessionItem[] = res.data.sessions || [];
        setSessions(list);
        if (!sessionIdParam && list.length > 0) {
          setSearchParams({ sessionId: list[0]._id });
        }
      })
      .catch(() => {});
  }, [sessionIdParam, setSearchParams]);

  // Load active session, messages, and summaries
  useEffect(() => {
    const targetId = sessionIdParam || sessions[0]?._id;
    if (!targetId) return;

    api
      .get(`/learning/sessions/${targetId}`)
      .then((res) => {
        setActiveSession(res.data.session);
        setMessages(res.data.messages || []);
        setSummaries(res.data.summaries || []);
        setSharedNotes(res.data.session?.sharedNotes || '');
        if (res.data.session?.learnerRating) {
          setRating(res.data.session.learnerRating);
        }
        if (res.data.session?.learnerFeedback) {
          setReviewComment(res.data.session.learnerFeedback);
        }
      })
      .catch(() => {});
  }, [sessionIdParam, sessions]);

  // Attach local & remote MediaStreams whenever video elements mount or update
  useEffect(() => {
    if (inVideoCall && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(() => {});
    }
  }, [inVideoCall]);

  useEffect(() => {
    if (inVideoCall && remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [inVideoCall, remoteConnected]);

  const flushPendingIceCandidates = async (pc: RTCPeerConnection) => {
    while (pendingIceCandidatesRef.current.length > 0) {
      const candidate = pendingIceCandidatesRef.current.shift();
      if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // ignore
        }
      }
    }
  };

  const getOrCreatePeerConnection = useCallback((sessionId: string) => {
    if (
      peerConnRef.current &&
      peerConnRef.current.signalingState !== 'closed'
    ) {
      return peerConnRef.current;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('webrtc:ice-candidate', {
          sessionId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const stream =
        event.streams && event.streams[0]
          ? event.streams[0]
          : new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      setRemoteConnected(true);
      setIncomingCallFrom(null);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setRemoteConnected(true);
        setIncomingCallFrom(null);
      } else if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        setRemoteConnected(false);
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    peerConnRef.current = pc;
    return pc;
  }, []);

  const ensureLocalMediaStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
    } catch {
      const synthetic = createSyntheticMediaStream(user?.name || 'Peer Student');
      localStreamRef.current = synthetic;
    }
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(() => {});
    }
    return localStreamRef.current;
  }, [user?.name]);

  // Connect Socket.IO for Real-Time Chat + WebRTC 1-on-1 Video Signaling
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token || !activeSession?._id) return;

    const currentSessionId = String(activeSession._id);
    const socket = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('session:join', { sessionId: currentSessionId });
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('chat:message', (incomingMsg: ChatMessageItem) => {
      if (
        incomingMsg.session &&
        String(incomingMsg.session) !== currentSessionId
      ) {
        return;
      }
      setMessages((prev) =>
        prev.some((m) => String(m._id) === String(incomingMsg._id))
          ? prev
          : [...prev, incomingMsg]
      );
    });

    socket.on(
      'notes:synced',
      (payload: { sessionId: string; sharedNotes: string }) => {
        if (String(payload.sessionId) === currentSessionId) {
          setSharedNotes(payload.sharedNotes);
        }
      }
    );

    // Notify if peer is already waiting in the video call when we open the page
    socket.on('webrtc:peer-in-call', () => {
      setIncomingCallFrom('Connected Peer');
    });

    socket.on(
      'webrtc:incoming-call',
      (payload: { sessionId: string; callerName?: string }) => {
        if (String(payload.sessionId) === currentSessionId) {
          setIncomingCallFrom(payload.callerName || 'Connected Peer');
        }
      }
    );

    // When the second peer clicks "Join / Accept Video Call" and emits webrtc:ready,
    // the peer who is already in the video call creates and sends the WebRTC Offer!
    socket.on('webrtc:peer-ready', async () => {
      if (!localStreamRef.current) return;
      try {
        if (peerConnRef.current) {
          peerConnRef.current.close();
          peerConnRef.current = null;
        }
        const pc = getOrCreatePeerConnection(currentSessionId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { sessionId: currentSessionId, offer });
        setVideoNotice('Connecting 1-on-1 video & audio stream with peer...');
      } catch (err) {
        console.error('[WebRTC Offer Error]:', err);
      }
    });

    // When a peer receives a WebRTC Offer, ensure local stream & PC exist, set remote description, and send Answer!
    socket.on(
      'webrtc:offer',
      async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
        try {
          setInVideoCall(true);
          setIncomingCallFrom(null);
          await ensureLocalMediaStream();

          if (peerConnRef.current) {
            peerConnRef.current.close();
            peerConnRef.current = null;
          }
          const pc = getOrCreatePeerConnection(currentSessionId);
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          await flushPendingIceCandidates(pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('webrtc:answer', {
            sessionId: currentSessionId,
            answer,
          });
          setVideoNotice('1-on-1 Live Video & Audio Call Connected!');
        } catch (err) {
          console.error('[WebRTC Offer Receive Error]:', err);
        }
      }
    );

    socket.on(
      'webrtc:answer',
      async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
        try {
          const pc = peerConnRef.current;
          if (pc && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            await flushPendingIceCandidates(pc);
            setRemoteConnected(true);
            setVideoNotice('1-on-1 Live Video & Audio Call Connected!');
          }
        } catch (err) {
          console.error('[WebRTC Answer Error]:', err);
        }
      }
    );

    socket.on(
      'webrtc:ice-candidate',
      async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
        if (!candidate) return;
        const pc = peerConnRef.current;
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            // ignore
          }
        } else {
          pendingIceCandidatesRef.current.push(candidate);
        }
      }
    );

    socket.on('webrtc:peer-left', () => {
      setRemoteConnected(false);
      setIncomingCallFrom(null);
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setVideoNotice('Connected peer left the video call.');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeSession?._id, ensureLocalMediaStream, getOrCreatePeerConnection]);

  // Also add a lightweight 2.5-second message sync poll as a safety net so even if a proxy drops a websocket frame, messages appear immediately without browser reload
  useEffect(() => {
    if (!activeSession?._id) return;
    const targetId = activeSession._id;
    const interval = window.setInterval(() => {
      api
        .get(`/learning/sessions/${targetId}`)
        .then((res) => {
          const serverMsgs: ChatMessageItem[] = res.data.messages || [];
          setMessages((prev) =>
            serverMsgs.length !== prev.length ? serverMsgs : prev
          );
        })
        .catch(() => {});
    }, 2500);

    return () => window.clearInterval(interval);
  }, [activeSession?._id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleStartOrAcceptVideoSession = async () => {
    if (!activeSession) return;
    setVideoNotice('');
    setInVideoCall(true);
    setIncomingCallFrom(null);

    try {
      const credRes = await api.get(
        `/learning/sessions/${activeSession._id}/video-credentials`
      );
      const creds = credRes.data;

      if (creds.configured && creds.appId) {
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        agoraClientRef.current = client;

        client.on('user-published', async (remoteUser, mediaType) => {
          await client.subscribe(remoteUser, mediaType);
          if (mediaType === 'video' && remoteVideoRef.current) {
            remoteUser.videoTrack?.play(remoteVideoRef.current);
            setRemoteConnected(true);
          }
          if (mediaType === 'audio') {
            remoteUser.audioTrack?.play();
          }
        });

        client.on('user-unpublished', () => {
          setRemoteConnected(false);
        });

        await client.join(
          creds.appId,
          creds.channelName,
          creds.token || null,
          creds.uid
        );
        const [audioTrack, videoTrack] =
          await AgoraRTC.createMicrophoneAndCameraTracks();
        agoraTracksRef.current = { audioTrack, videoTrack };
        if (localVideoRef.current) {
          videoTrack.play(localVideoRef.current);
        }
        await client.publish([audioTrack, videoTrack]);
        setVideoNotice('Connected to Agora 1-on-1 Video Channel.');
        return;
      }
    } catch {
      // Fallback to native WebRTC over Socket.IO
    }

    await ensureLocalMediaStream();
    getOrCreatePeerConnection(String(activeSession._id));
    socketRef.current?.emit('webrtc:ready', {
      sessionId: String(activeSession._id),
    });
    setVideoNotice(
      '1-on-1 Live Video Room active. Waiting for peer or connecting streams automatically...'
    );
  };

  const handleEndVideoAndGenerateSummary = async () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (peerConnRef.current) {
      peerConnRef.current.close();
      peerConnRef.current = null;
    }
    if (agoraTracksRef.current.videoTrack) {
      agoraTracksRef.current.videoTrack.stop();
      agoraTracksRef.current.videoTrack.close();
    }
    if (agoraTracksRef.current.audioTrack) {
      agoraTracksRef.current.audioTrack.stop();
      agoraTracksRef.current.audioTrack.close();
    }
    if (agoraClientRef.current) {
      await agoraClientRef.current.leave().catch(() => {});
      agoraClientRef.current = null;
    }
    if (activeSession) {
      socketRef.current?.emit('webrtc:leave', {
        sessionId: String(activeSession._id),
      });
    }
    setInVideoCall(false);
    setRemoteConnected(false);
    setIncomingCallFrom(null);

    // Automatically generate AI session summary right after ending the video session!
    if (activeSession) {
      try {
        setCompletingSession(true);
        const res = await api.post(
          `/learning/sessions/${activeSession._id}/summarize`,
          {
            rawNotes:
              sharedNotes ||
              `Completed 1-on-1 video session on ${activeSession.topic}.`,
          }
        );
        if (res.data.summary) {
          setSummaries((prev) => [res.data.summary, ...prev]);
        }
        setVideoNotice(
          'Video session ended and AI Session Summary generated below! You can continue asking follow-up doubts in chat or submit your rating & review.'
        );
      } catch {
        // ignore
      } finally {
        setCompletingSession(false);
      }
    }
  };

  const toggleCamera = () => {
    const next = !cameraOn;
    setCameraOn(next);
    if (localStreamRef.current) {
      localStreamRef.current
        .getVideoTracks()
        .forEach((t) => (t.enabled = next));
    }
    if (agoraTracksRef.current.videoTrack) {
      agoraTracksRef.current.videoTrack.setEnabled(next);
    }
  };

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    if (localStreamRef.current) {
      localStreamRef.current
        .getAudioTracks()
        .forEach((t) => (t.enabled = next));
    }
    if (agoraTracksRef.current.audioTrack) {
      agoraTracksRef.current.audioTrack.setEnabled(next);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputContent.trim() || !activeSession) return;

    const text = inputContent;
    setInputContent('');

    // Always POST via HTTP endpoint which saves to MongoDB AND broadcasts via Socket.IO to both users immediately!
    try {
      const res = await api.post(
        `/learning/sessions/${activeSession._id}/messages`,
        {
          content: text,
          messageType,
          codeLanguage,
        }
      );
      const saved = res.data.message;
      setMessages((prev) =>
        prev.some((m) => String(m._id) === String(saved._id))
          ? prev
          : [...prev, saved]
      );
    } catch {
      // Fallback to socket emit if needed
      socketRef.current?.emit('chat:send', {
        sessionId: String(activeSession._id),
        content: text,
        messageType,
        codeLanguage,
      });
    }
  };

  const handleSubmitPeerReviewAndSummary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;
    setCompletingSession(true);
    setReviewSuccessBanner('');

    try {
      const res = await api.patch(
        `/learning/sessions/${activeSession._id}/complete`,
        {
          rating,
          feedback:
            reviewComment.trim() ||
            'Clear explanation during our 1-on-1 peer video & chat session!',
          rawNotes: sharedNotes,
          generateSummary: true,
        }
      );
      setActiveSession(res.data.session);
      if (res.data.summary) {
        setSummaries((prev) => [res.data.summary, ...prev]);
      }
      await refreshUser();
      setReviewSuccessBanner(
        'Your rating & review have been saved to your peer’s profile, and the AI Session Summary has been updated!'
      );
    } catch {
      // ignore
    } finally {
      setCompletingSession(false);
    }
  };

  const partnerName =
    activeSession?.mentor?._id === user?._id
      ? activeSession?.learner?.name
      : activeSession?.mentor?.name;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 font-display">
            1-on-1 Video Call, Real-Time Peer Chat & AI Session Summary
          </h1>
          <p className="text-sm text-slate-600">
            Communicate via live 1-on-1 video session, ask follow-up doubts in real-time chat, generate AI session summaries, and rate the explaining peer
          </p>
        </div>

        {sessions.length > 0 && (
          <select
            value={activeSession?._id || ''}
            onChange={(e) => setSearchParams({ sessionId: e.target.value })}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white"
          >
            {sessions.map((s) => (
              <option key={s._id} value={s._id}>
                Session: {s.topic} ({s.learner?.name} & {s.mentor?.name})
              </option>
            ))}
          </select>
        )}
      </div>

      {activeSession ? (
        <>
          {/* 1. Integrated 1-on-1 Video Call Stage */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 text-white space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono text-blue-400">
                  1-on-1 Interactive Video Room · Channel:{' '}
                  {activeSession.channelName}
                </span>
                <h2 className="text-base font-bold">
                  Topic: {activeSession.topic} (Connected Peer:{' '}
                  {partnerName || 'Peer Student'})
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!inVideoCall ? (
                  <button
                    type="button"
                    onClick={handleStartOrAcceptVideoSession}
                    className={`px-4 py-2 text-xs font-semibold text-white rounded-lg flex items-center gap-1.5 cursor-pointer ${
                      incomingCallFrom
                        ? 'bg-emerald-600 hover:bg-emerald-700 animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {incomingCallFrom ? (
                      <>
                        <PhoneCall className="w-4 h-4" />
                        Accept & Connect 1-on-1 Video Call from{' '}
                        {partnerName || incomingCallFrom}
                      </>
                    ) : (
                      <>
                        <Video className="w-4 h-4" />
                        Start 1-on-1 Video Call
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={toggleCamera}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer ${
                        cameraOn ? 'bg-slate-800 text-white' : 'bg-amber-600'
                      }`}
                    >
                      {cameraOn ? (
                        <Video className="w-3.5 h-3.5" />
                      ) : (
                        <VideoOff className="w-3.5 h-3.5" />
                      )}
                      {cameraOn ? 'Camera On' : 'Camera Off'}
                    </button>
                    <button
                      type="button"
                      onClick={toggleMic}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer ${
                        micOn ? 'bg-slate-800 text-white' : 'bg-amber-600'
                      }`}
                    >
                      {micOn ? (
                        <Mic className="w-3.5 h-3.5" />
                      ) : (
                        <MicOff className="w-3.5 h-3.5" />
                      )}
                      {micOn ? 'Mic On' : 'Mic Muted'}
                    </button>
                    <button
                      type="button"
                      onClick={handleEndVideoAndGenerateSummary}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                      End Video & Generate AI Summary
                    </button>
                  </>
                )}
              </div>
            </div>

            {incomingCallFrom && !inVideoCall && (
              <div className="p-3.5 rounded-lg bg-emerald-950/90 border border-emerald-500/60 flex items-center justify-between gap-4">
                <p className="text-xs text-emerald-200 font-medium">
                  <strong>{partnerName || incomingCallFrom}</strong> is in the 1-on-1 video room waiting to connect with you!
                </p>
                <button
                  type="button"
                  onClick={handleStartOrAcceptVideoSession}
                  className="px-3.5 py-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-md shrink-0 cursor-pointer"
                >
                  Connect Video Now
                </button>
              </div>
            )}

            {videoNotice && (
              <p className="text-xs text-blue-200 bg-slate-800/90 px-3.5 py-2 rounded-lg border border-slate-700">
                {videoNotice}
              </p>
            )}

            {inVideoCall && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="relative h-60 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-2 left-2 text-xs bg-slate-900/80 px-2.5 py-1 rounded">
                    You ({user?.name})
                  </span>
                </div>

                <div className="relative h-60 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={`w-full h-full object-cover ${
                      remoteConnected ? 'block' : 'hidden'
                    }`}
                  />
                  {!remoteConnected && (
                    <div className="text-center p-4 space-y-2">
                      <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="text-xs font-semibold text-slate-200">
                        Connected Peer: {partnerName || 'Peer'}
                      </p>
                      <p className="text-xs text-slate-400">
                        Waiting for {partnerName || 'peer'} to click “Start / Connect Video Call”...
                      </p>
                    </div>
                  )}
                  <span className="absolute bottom-2 left-2 text-xs bg-slate-900/80 px-2.5 py-1 rounded">
                    Peer ({partnerName || 'Partner'}){' '}
                    {remoteConnected ? '· Connected' : ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 2. Real-Time Chat + Post-Session AI Summary & Peer Review Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Real-Time Chat Column for Follow-Up Doubts (7 cols) */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 flex flex-col h-[560px]">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Real-Time Doubt & Follow-Up Chat with {partnerName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Messages appear live for both peers without reloading
                  </p>
                </div>
                <span className="text-xs font-mono text-emerald-700">
                  {socketConnected ? 'Live Socket.IO' : 'Live Synced'}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
                {messages.map((msg) => {
                  const isMe = String(msg.sender) === String(user?._id);
                  return (
                    <div
                      key={msg._id}
                      className={`flex flex-col ${
                        isMe ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {msg.senderName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {msg.messageType === 'code' ? (
                        <div className="max-w-xl w-full rounded-lg overflow-hidden border border-slate-800 bg-slate-900 text-slate-100">
                          <div className="px-3 py-1 bg-slate-800 text-xs font-mono text-slate-300">
                            Code ({msg.codeLanguage || 'code'})
                          </div>
                          <pre className="p-3 text-xs font-mono overflow-x-auto">
                            <code>{msg.content}</code>
                          </pre>
                        </div>
                      ) : (
                        <div
                          className={`max-w-md px-4 py-2.5 rounded-xl text-sm ${
                            isMe
                              ? 'bg-blue-600 text-white'
                              : 'bg-white border border-slate-200 text-slate-800'
                          }`}
                        >
                          {msg.content}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <form
                onSubmit={handleSendMessage}
                className="p-4 border-t border-slate-200 bg-white space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setMessageType('text')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                        messageType === 'text'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      <MessageSquare className="w-3 h-3 inline mr-1" />
                      Doubt / Text
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageType('code')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                        messageType === 'code'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      <Code2 className="w-3 h-3 inline mr-1" />
                      Code
                    </button>
                  </div>
                  {messageType === 'code' && (
                    <select
                      value={codeLanguage}
                      onChange={(e) => setCodeLanguage(e.target.value)}
                      className="px-2 py-1 text-xs font-mono border border-slate-300 rounded"
                    >
                      <option value="python">python</option>
                      <option value="javascript">javascript</option>
                      <option value="java">java</option>
                      <option value="sql">sql</option>
                    </select>
                  )}
                </div>

                <div className="flex gap-2">
                  {messageType === 'code' ? (
                    <textarea
                      rows={2}
                      value={inputContent}
                      onChange={(e) => setInputContent(e.target.value)}
                      placeholder="Paste code snippet..."
                      className="flex-1 px-3 py-2 text-xs font-mono bg-slate-900 text-slate-100 rounded-lg"
                    />
                  ) : (
                    <input
                      type="text"
                      value={inputContent}
                      onChange={(e) => setInputContent(e.target.value)}
                      placeholder={`Ask a follow-up doubt to ${partnerName}...`}
                      className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none"
                    />
                  )}
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: Post-Session Rating/Review for Explained Peer & AI Session Summary (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* Listener Rating & Review Form */}
              <form
                onSubmit={handleSubmitPeerReviewAndSummary}
                className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
              >
                <h3 className="text-sm font-bold text-slate-900 font-display">
                  Rate & Review Explained Peer ({partnerName}) + Generate AI Summary
                </h3>

                {reviewSuccessBanner && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{reviewSuccessBanner}</span>
                  </div>
                )}

                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Rating for {partnerName} (1 to 5 Stars)
                  </span>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-1 cursor-pointer ${
                          rating >= star
                            ? 'bg-amber-50 border-amber-400 text-amber-800'
                            : 'bg-white border-slate-200 text-slate-400'
                        }`}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            rating >= star
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-slate-300'
                          }`}
                        />
                        {star}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="rev-feedback"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Review Feedback for Explaining Peer
                  </label>
                  <textarea
                    id="rev-feedback"
                    rows={2}
                    required
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder={`How well did ${partnerName} explain the concept and resolve your doubt?`}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label
                    htmlFor="rev-notes"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Session Notes (Included in AI Session Summary)
                  </label>
                  <textarea
                    id="rev-notes"
                    rows={2}
                    value={sharedNotes}
                    onChange={(e) => setSharedNotes(e.target.value)}
                    placeholder="Key points discussed during the video session..."
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300"
                  />
                </div>

                <button
                  type="submit"
                  disabled={completingSession}
                  className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {completingSession
                    ? 'Saving Review & Generating AI Summary...'
                    : 'Submit Peer Review & Generate AI Session Summary'}
                </button>
              </form>

              {/* Generated AI Session Summaries */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 font-display">
                  AI Session Summary ({summaries.length})
                </h3>

                {summaries.length > 0 ? (
                  <div className="space-y-4">
                    {summaries.slice(0, 2).map((sum) => (
                      <div
                        key={sum._id}
                        className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3 text-xs"
                      >
                        <p className="text-slate-800 leading-relaxed font-medium">
                          {sum.summaryText}
                        </p>

                        <div className="space-y-1">
                          <p className="font-bold text-slate-900 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Key Concepts Learned:
                          </p>
                          <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                            {sum.keyConceptsLearned.map((c, idx) => (
                              <li key={idx}>{c}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1">
                          <p className="font-bold text-slate-900 flex items-center gap-1">
                            <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                            Topics Needing Practice:
                          </p>
                          <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                            {sum.topicsNeedingPractice.map((c, idx) => (
                              <li key={idx}>{c}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1">
                          <p className="font-bold text-slate-900 flex items-center gap-1">
                            <ArrowRight className="w-3.5 h-3.5 text-blue-600" />
                            Recommended Next Topics:
                          </p>
                          <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                            {sum.recommendedNextTopics.map((c, idx) => (
                              <li key={idx}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    End your 1-on-1 video call or click “Submit Peer Review & Generate AI Session Summary” above to produce your structured summary.
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-4">
          <Bot className="w-8 h-8 text-blue-600 mx-auto" />
          <p className="text-sm text-slate-600">
            No active 1-on-1 peer session yet. Ask a doubt in the AI Agent tab and connect with an available peer!
          </p>
          <Link
            to="/ai-agent"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg"
          >
            Go to AI Agent & Match Peers
          </Link>
        </div>
      )}
    </div>
  );
}
