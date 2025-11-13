import { useCallback, useEffect, useRef, useState } from "react";
import {
	get,
	getDatabase,
	onValue,
	push,
	ref,
	remove,
	set,
} from "firebase/database";
import { initializeApp } from "firebase/app";
import Head from "next/head";
import styled from "styled-components";

const firebaseConfig = {
	apiKey: "AIzaSyCYJfOENnC2SMku-pkp3NaXcdja7Qyo8JM",
	authDomain: "dualspeaker.firebaseapp.com",
	projectId: "dualspeaker",
	storageBucket: "dualspeaker.firebasestorage.app",
	messagingSenderId: "792376532076",
	appId: "1:792376532076:web:5ab8045469434ce66d8c49",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

type ExtendedRtpEncodingParameters = RTCRtpEncodingParameters & {
        dtx?: "enabled" | "disabled";
};

const ICE_SERVERS: RTCIceServer[] = [
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "stun:stun1.l.google.com:19302" },
];

const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
	audio: {
		channelCount: 1,
		sampleRate: 16000,
		sampleSize: 16,
		echoCancellation: true,
		noiseSuppression: true,
		autoGainControl: true,
	},
	video: false,
};

// Styled Components
const Container = styled.main`
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
  background-color: #f8f9fa;
  min-height: 100vh;
  font-family: 'Poppins', sans-serif;
`;

const Title = styled.h1`
  font-size: 2rem;
  font-weight: bold;
  color: #2d3748;
  margin-bottom: 2rem;
  text-align: center;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e2e8f0;
  border-radius: 0.5rem;
  font-size: 1rem;
  margin-bottom: 1rem;
  transition: border-color 0.2s;

  &:focus {
    outline: none;
    border-color: #4299e1;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
`;

const Button = styled.button<{ variant?: "primary" | "secondary" }>`
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 600;
  transition: all 0.2s;
  flex: 1;
  background-color: ${(props) => (props.variant === "primary" ? "#4299e1" : "#48bb78")};
  color: white;
  border: none;
  cursor: pointer;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const StatusMessage = styled.p<{ type?: "success" | "error" }>`
  padding: 1rem;
  border-radius: 0.5rem;
  margin-top: 1rem;
  background-color: ${(props) => (props.type === "error" ? "#fed7d7" : "#c6f6d5")};
  color: ${(props) => (props.type === "error" ? "#c53030" : "#2f855a")};
`;

const MicrophoneStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.75rem;
  background-color: #ebf8ff;
  border-radius: 0.5rem;
`;

export default function Home() {
	const [roomId, setRoomId] = useState("");
	const [inCall, setInCall] = useState(false);
	const [isMicrophoneActive, setIsMicrophoneActive] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [isRoomCreator, setIsRoomCreator] = useState(false);
	const localStreamRef = useRef<MediaStream | null>(null);
	const peerConnection = useRef<RTCPeerConnection | null>(null);
	const audioContext = useRef<AudioContext | null>(null);
	const analyser = useRef<AnalyserNode | null>(null);
	const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
	const connectionSubscriptions = useRef<Array<() => void>>([]);
	const roomIdRef = useRef(roomId);
	const hasLocalStream = Boolean(localStreamRef.current);

	const initializeAudioContext = () => {
		if (!audioContext.current) {
			audioContext.current = new AudioContext();
			analyser.current = audioContext.current.createAnalyser();
			analyser.current.fftSize = 256;
		}
	};

	const checkMicrophoneActivity = useCallback(() => {
		if (!analyser.current || !localStreamRef.current) return;

		const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
		analyser.current.getByteFrequencyData(dataArray);

		const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
		setIsMicrophoneActive(average > 10);
	}, []);

	const clearSubscriptions = useCallback(() => {
		connectionSubscriptions.current.forEach((unsubscribe) => unsubscribe());
		connectionSubscriptions.current = [];
	}, []);

	const cleanupConnection = useCallback(
		async (removeRoomData = false, targetRoomId?: string) => {
			clearSubscriptions();

			if (peerConnection.current) {
				peerConnection.current.onicecandidate = null;
				peerConnection.current.onconnectionstatechange = null;
				peerConnection.current.ontrack = null;
				peerConnection.current.close();
				peerConnection.current = null;
			}

			if (remoteAudioRef.current) {
				remoteAudioRef.current.srcObject = null;
			}

			setInCall(false);
			setStatusMessage(null);
			setIsRoomCreator(false);

			const roomToClear = targetRoomId ?? roomIdRef.current;

			if (removeRoomData && roomToClear) {
				try {
					await remove(ref(db, `rooms/${roomToClear}`));
				} catch (err) {
					console.warn("Não foi possível limpar a sala:", err);
				}
			}
		},
		[clearSubscriptions],
	);

	const applyAudioBandwidthConstraints = useCallback(() => {
		const sender = peerConnection.current
			?.getSenders()
			.find((trackSender) => trackSender.track?.kind === "audio");

		if (!sender) return;

                const params = sender.getParameters();
                if (!params.encodings || params.encodings.length === 0) {
                        params.encodings = [{}];
                }

                const encoding = params.encodings[0] as ExtendedRtpEncodingParameters;
                encoding.maxBitrate = 24000; // ~24 kbps para redes 3G
                encoding.dtx = "enabled";
                encoding.priority = "medium";

		sender.setParameters(params).catch((err) => {
			console.warn("Não foi possível aplicar limitações de banda: ", err);
		});
	}, []);

	const attachLocalStreamToPeer = useCallback(() => {
		if (!peerConnection.current || !localStreamRef.current) {
			return false;
		}

		localStreamRef.current.getTracks().forEach((track) => {
			peerConnection.current?.addTrack(track, localStreamRef.current!);
		});

		applyAudioBandwidthConstraints();
		return true;
	}, [applyAudioBandwidthConstraints]);

	const buildPeerConnection = useCallback(
		(
			roomKey: string,
			candidateKey: "callerCandidates" | "calleeCandidates",
		) => {
			const pc = new RTCPeerConnection({
				iceServers: ICE_SERVERS,
				bundlePolicy: "max-bundle",
			});

			peerConnection.current = pc;

			pc.onicecandidate = (event) => {
				if (event.candidate) {
					const candidatesRef = ref(db, `rooms/${roomKey}/${candidateKey}`);
					void set(push(candidatesRef), event.candidate.toJSON());
				}
			};

			pc.onconnectionstatechange = () => {
				if (!peerConnection.current) return;

				switch (peerConnection.current.connectionState) {
					case "connected":
						setError(null);
						setStatusMessage(`Conectado à sala ${roomKey}`);
						break;
					case "failed":
						setError("Não foi possível estabelecer a conexão");
						setStatusMessage(null);
						break;
					case "disconnected":
					case "closed":
						setError("Conexão perdida");
						setStatusMessage(null);
						break;
					default:
						break;
				}
			};

			pc.ontrack = (event) => {
				const [remoteStream] = event.streams;
				if (remoteAudioRef.current && remoteStream) {
					remoteAudioRef.current.srcObject = remoteStream;
				}
			};

			return pc;
		},
		[],
	);

	const createRoom = useCallback(async () => {
		const trimmedRoomId = roomId.trim();

		if (!trimmedRoomId) {
			setError("Por favor, insira um ID de sala");
			return;
		}

		if (!localStreamRef.current) {
			setError("Ative o microfone para criar a sala");
			return;
		}

		try {
			setRoomId(trimmedRoomId);
			setError(null);
			setStatusMessage("Preparando a sala...");

			await cleanupConnection(true, trimmedRoomId);

			const pc = buildPeerConnection(trimmedRoomId, "callerCandidates");

			if (!attachLocalStreamToPeer()) {
				setError("Não foi possível iniciar o áudio local");
				return;
			}

			const offer = await pc.createOffer({
				offerToReceiveAudio: true,
				offerToReceiveVideo: false,
			});
			await pc.setLocalDescription(offer);

			await set(ref(db, `rooms/${trimmedRoomId}/offer`), offer);
			setInCall(true);
			setIsRoomCreator(true);
			setStatusMessage("Sala criada. Aguardando outro participante...");

			const answerUnsubscribe = onValue(
				ref(db, `rooms/${trimmedRoomId}/answer`),
				async (snapshot) => {
					const answer = snapshot.val();
					if (
						answer &&
						peerConnection.current &&
						!peerConnection.current.currentRemoteDescription
					) {
						const remoteDesc = new RTCSessionDescription(answer);
						await peerConnection.current.setRemoteDescription(remoteDesc);
					}
				},
			);

			const candidatesUnsubscribe = onValue(
				ref(db, `rooms/${trimmedRoomId}/calleeCandidates`),
				(snapshot) => {
					const candidates = snapshot.val();
					if (candidates && peerConnection.current) {
						Object.values(candidates).forEach((candidate: any) => {
							peerConnection.current?.addIceCandidate(
								new RTCIceCandidate(candidate),
							);
						});
					}
				},
			);

			connectionSubscriptions.current.push(answerUnsubscribe);
			connectionSubscriptions.current.push(candidatesUnsubscribe);
		} catch (err) {
			setError("Erro ao criar sala: " + (err as Error).message);
			await cleanupConnection(true, trimmedRoomId);
		}
	}, [attachLocalStreamToPeer, buildPeerConnection, cleanupConnection, roomId]);

	const joinRoom = useCallback(async () => {
		const trimmedRoomId = roomId.trim();

		if (!trimmedRoomId) {
			setError("Por favor, insira um ID de sala");
			return;
		}

		if (!localStreamRef.current) {
			setError("Ative o microfone para entrar na sala");
			return;
		}

		try {
			setRoomId(trimmedRoomId);
			setError(null);
			setStatusMessage("Buscando a sala...");

			await cleanupConnection(false, trimmedRoomId);

			const pc = buildPeerConnection(trimmedRoomId, "calleeCandidates");

			if (!attachLocalStreamToPeer()) {
				setError("Não foi possível iniciar o áudio local");
				return;
			}

			const offerSnapshot = await get(ref(db, `rooms/${trimmedRoomId}/offer`));
			const offer = offerSnapshot.val();

			if (!offer) {
				setError("Sala não encontrada ou ainda sem anfitrião");
				await cleanupConnection(false, trimmedRoomId);
				return;
			}

			await pc.setRemoteDescription(new RTCSessionDescription(offer));
			const answer = await pc.createAnswer({
				offerToReceiveAudio: true,
				offerToReceiveVideo: false,
			});
			await pc.setLocalDescription(answer);
			await set(ref(db, `rooms/${trimmedRoomId}/answer`), answer);

			setInCall(true);
			setIsRoomCreator(false);
			setStatusMessage("Sala encontrada. Conectando...");

			const callerCandidatesUnsubscribe = onValue(
				ref(db, `rooms/${trimmedRoomId}/callerCandidates`),
				(snapshot) => {
					const candidates = snapshot.val();
					if (candidates && peerConnection.current) {
						Object.values(candidates).forEach((candidate: any) => {
							peerConnection.current?.addIceCandidate(
								new RTCIceCandidate(candidate),
							);
						});
					}
				},
			);

			connectionSubscriptions.current.push(callerCandidatesUnsubscribe);
		} catch (err) {
			setError("Erro ao entrar na sala: " + (err as Error).message);
			await cleanupConnection(false, trimmedRoomId);
		}
	}, [attachLocalStreamToPeer, buildPeerConnection, cleanupConnection, roomId]);

	const leaveRoom = useCallback(async () => {
		setError(null);
		const trimmedRoomId = roomId.trim();
		await cleanupConnection(isRoomCreator, trimmedRoomId || undefined);
		setStatusMessage("Chamada encerrada");
	}, [cleanupConnection, isRoomCreator, roomId]);

	useEffect(() => {
		roomIdRef.current = roomId;
	}, [roomId]);

	useEffect(() => {
		let activityInterval: number | null = null;

		const getAudio = async () => {
			try {
				const stream =
					await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);

				localStreamRef.current = stream;
				initializeAudioContext();

				if (audioContext.current && analyser.current) {
					const source = audioContext.current.createMediaStreamSource(stream);
					source.connect(analyser.current);
				}

				activityInterval = window.setInterval(checkMicrophoneActivity, 120);
				setStatusMessage("Microfone pronto para uso");
			} catch (err) {
				setError("Erro ao acessar o microfone: " + (err as Error).message);
			}
		};

		void getAudio();

		return () => {
			if (activityInterval) {
				window.clearInterval(activityInterval);
			}

			localStreamRef.current?.getTracks().forEach((track) => track.stop());
			localStreamRef.current = null;

			if (audioContext.current) {
				audioContext.current.close();
				audioContext.current = null;
			}

			void cleanupConnection();
		};
	}, [checkMicrophoneActivity, cleanupConnection]);

	return (
		<>
			<Head>
				<title>Áudio P2P</title>
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<link rel="manifest" href="/manifest.json" />
				<meta name="theme-color" content="#ffffff" />
			</Head>
			<Container>
				<Title>P2P Áudio Chat</Title>
				<Input
					type="text"
					placeholder="Digite o ID da sala"
					value={roomId}
					onChange={(e) => setRoomId(e.target.value)}
				/>
				<ButtonGroup>
					<Button
						variant="secondary"
						onClick={() => void createRoom()}
						disabled={inCall || !hasLocalStream}
					>
						Criar Sala
					</Button>
					<Button
						variant="primary"
						onClick={() => void joinRoom()}
						disabled={inCall || !hasLocalStream}
					>
						Entrar na Sala
					</Button>
				</ButtonGroup>

				{inCall && (
					<ButtonGroup>
						<Button variant="secondary" onClick={() => void leaveRoom()}>
							Encerrar chamada
						</Button>
					</ButtonGroup>
				)}

				{error && <StatusMessage type="error">{error}</StatusMessage>}
				{statusMessage && !error && (
					<StatusMessage type="success">{statusMessage}</StatusMessage>
				)}

				<audio
					ref={remoteAudioRef}
					autoPlay
					playsInline
					style={{ display: "none" }}
					aria-hidden="true"
				/>

				<MicrophoneStatus>
					<div
						style={{
							width: "12px",
							height: "12px",
							borderRadius: "50%",
							backgroundColor: isMicrophoneActive ? "#48bb78" : "#e53e3e",
							transition: "background-color 0.2s",
						}}
					/>
					<span>
						{isMicrophoneActive ? "Microfone ativo" : "Microfone inativo"}
					</span>
				</MicrophoneStatus>
			</Container>
		</>
	);
}
