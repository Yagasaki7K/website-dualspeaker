import { useEffect, useRef, useState } from "react";
import { getDatabase, ref, onValue, set } from "firebase/database";
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
	const localStreamRef = useRef<MediaStream | null>(null);
	const peerConnection = useRef<RTCPeerConnection | null>(null);
	const audioContext = useRef<AudioContext | null>(null);
	const analyser = useRef<AnalyserNode | null>(null);

	const initializeAudioContext = () => {
		if (!audioContext.current) {
			audioContext.current = new AudioContext();
			analyser.current = audioContext.current.createAnalyser();
			analyser.current.fftSize = 256;
		}
	};

	const checkMicrophoneActivity = () => {
		if (!analyser.current || !localStreamRef.current) return;

		const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
		analyser.current.getByteFrequencyData(dataArray);

		const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
		setIsMicrophoneActive(average > 10);
	};

	const createRoom = async () => {
		try {
			if (!roomId) {
				setError("Por favor, insira um ID de sala");
				return;
			}

			peerConnection.current = new RTCPeerConnection({
				iceServers: [
					{ urls: "stun:stun.l.google.com:19302" },
					{ urls: "stun:stun1.l.google.com:19302" },
				],
			});

			localStreamRef.current?.getTracks().forEach((track) => {
				peerConnection.current?.addTrack(track, localStreamRef.current!);
			});

			peerConnection.current.onicecandidate = (event) => {
				if (event.candidate) {
					set(
						ref(
							db,
							`rooms/${roomId}/callerCandidates/${event.candidate.candidate}`,
						),
						event.candidate.toJSON(),
					);
				}
			};

			peerConnection.current.onconnectionstatechange = () => {
				if (peerConnection.current?.connectionState === "connected") {
					setError(null);
				} else if (peerConnection.current?.connectionState === "disconnected") {
					setError("Conexão perdida");
				}
			};

			const offer = await peerConnection.current.createOffer();
			await peerConnection.current.setLocalDescription(offer);

			set(ref(db, `rooms/${roomId}/offer`), offer);
			setInCall(true);

			onValue(ref(db, `rooms/${roomId}/answer`), async (snapshot) => {
				const answer = snapshot.val();
				if (
					answer &&
					peerConnection.current &&
					!peerConnection.current.currentRemoteDescription
				) {
					const remoteDesc = new RTCSessionDescription(answer);
					await peerConnection.current.setRemoteDescription(remoteDesc);
				}
			});

			onValue(ref(db, `rooms/${roomId}/calleeCandidates`), (snapshot) => {
				const candidates = snapshot.val();
				if (candidates && peerConnection.current) {
					Object.values(candidates).forEach((candidate: any) => {
						peerConnection.current?.addIceCandidate(
							new RTCIceCandidate(candidate),
						);
					});
				}
			});
		} catch (err) {
			setError("Erro ao criar sala: " + (err as Error).message);
		}
	};

	const joinRoom = async () => {
		try {
			if (!roomId) {
				setError("Por favor, insira um ID de sala");
				return;
			}

			peerConnection.current = new RTCPeerConnection({
				iceServers: [
					{ urls: "stun:stun.l.google.com:19302" },
					{ urls: "stun:stun1.l.google.com:19302" },
				],
			});

			localStreamRef.current?.getTracks().forEach((track) => {
				peerConnection.current?.addTrack(track, localStreamRef.current!);
			});

			peerConnection.current.onicecandidate = (event) => {
				if (event.candidate) {
					set(
						ref(
							db,
							`rooms/${roomId}/calleeCandidates/${event.candidate.candidate}`,
						),
						event.candidate.toJSON(),
					);
				}
			};

			peerConnection.current.onconnectionstatechange = () => {
				if (peerConnection.current?.connectionState === "connected") {
					setError(null);
				} else if (peerConnection.current?.connectionState === "disconnected") {
					setError("Conexão perdida");
				}
			};

			onValue(ref(db, `rooms/${roomId}/offer`), async (snapshot) => {
				const offer = snapshot.val();
				if (offer) {
					await peerConnection.current?.setRemoteDescription(
						new RTCSessionDescription(offer),
					);
					const answer = await peerConnection.current?.createAnswer();
					await peerConnection.current?.setLocalDescription(answer);
					set(ref(db, `rooms/${roomId}/answer`), answer);
				}
			});

			onValue(ref(db, `rooms/${roomId}/callerCandidates`), (snapshot) => {
				const candidates = snapshot.val();
				if (candidates) {
					Object.values(candidates).forEach((candidate: any) => {
						peerConnection.current?.addIceCandidate(
							new RTCIceCandidate(candidate),
						);
					});
				}
			});

			setInCall(true);
		} catch (err) {
			setError("Erro ao entrar na sala: " + (err as Error).message);
		}
	};

	useEffect(() => {
		const getAudio = async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
					video: false,
				});

				localStreamRef.current = stream;
				initializeAudioContext();

				if (audioContext.current && analyser.current) {
					const source = audioContext.current.createMediaStreamSource(stream);
					source.connect(analyser.current);
				}

				// Check microphone activity every 100ms
				const interval = setInterval(checkMicrophoneActivity, 100);
				return () => clearInterval(interval);
			} catch (err) {
				setError("Erro ao acessar o microfone: " + (err as Error).message);
			}
		};
		getAudio();

		return () => {
			localStreamRef.current?.getTracks().forEach((track) => track.stop());
			if (audioContext.current) {
				audioContext.current.close();
			}
		};
	}, []);

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
					<Button variant="secondary" onClick={createRoom} disabled={inCall}>
						Criar Sala
					</Button>
					<Button variant="primary" onClick={joinRoom} disabled={inCall}>
						Entrar na Sala
					</Button>
				</ButtonGroup>

				{error && <StatusMessage type="error">{error}</StatusMessage>}
				{inCall && (
					<StatusMessage type="success">
						Conectado à sala: {roomId}
					</StatusMessage>
				)}

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
