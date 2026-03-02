import { useState, useRef, useCallback, useEffect } from 'react';
import { logger } from '../utils/logger';

interface UseDeviceTestOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  getAudioConstraints?: () => MediaStreamConstraints['audio'];
  getVideoConstraints?: () => MediaStreamConstraints['video'];
}

interface UseDeviceTestReturn {
  testingAudio: boolean;
  testingVideo: boolean;
  audioLevel: number;
  /** Un-doubled audio level (0-100) matching the VAD threshold scale */
  rawAudioLevel: number;
  testAudioInput: () => Promise<void>;
  testVideoInput: () => Promise<void>;
  stopAudioTest: () => void;
  stopVideoTest: () => void;
}

/**
 * Formats a device label for display. Falls back to a truncated device ID
 * when the browser has not yet been granted permission to read labels.
 */
export function getDeviceLabel(device: MediaDeviceInfo): string {
  if (!device.label || device.label === '') {
    return `${device.kind} (${device.deviceId.slice(0, 8)}...)`;
  }
  return device.label;
}

/**
 * useDeviceTest Hook
 *
 * Encapsulates all audio/video device testing logic including stream
 * acquisition, audio-level analysis via AnalyserNode, and cleanup.
 *
 * Both DeviceSettingsDialog and VoiceSettings use this hook to avoid
 * duplicating the same ~80 lines of test plumbing.
 */
export function useDeviceTest({
  videoRef,
  getAudioConstraints,
  getVideoConstraints,
}: UseDeviceTestOptions): UseDeviceTestReturn {
  const [testingAudio, setTestingAudio] = useState(false);
  const [testingVideo, setTestingVideo] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [rawAudioLevel, setRawAudioLevel] = useState(0);

  const testStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const stopAudioTest = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (testStreamRef.current) {
      testStreamRef.current.getAudioTracks().forEach((track) => track.stop());
      // Only null out the stream if there are no remaining video tracks
      if (testStreamRef.current.getVideoTracks().length === 0) {
        testStreamRef.current = null;
      }
    }

    analyserRef.current = null;
    setAudioLevel(0);
    setRawAudioLevel(0);
    setTestingAudio(false);
  }, []);

  const stopVideoTest = useCallback(() => {
    if (testStreamRef.current) {
      testStreamRef.current.getVideoTracks().forEach((track) => track.stop());
      // Only null out the stream if there are no remaining audio tracks
      if (testStreamRef.current.getAudioTracks().length === 0) {
        testStreamRef.current = null;
      }
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTestingVideo(false);
  }, [videoRef]);

  const testAudioInput = useCallback(async () => {
    if (testingAudio) {
      stopAudioTest();
      return;
    }

    setTestingAudio(true);
    try {
      const audioConstraints = getAudioConstraints ? getAudioConstraints() : true;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      microphone.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      testStreamRef.current = stream;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = (): void => {
        if (!analyserRef.current) return;

        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const raw = (average / 255) * 100;
        const level = Math.min(100, raw * 2);
        setRawAudioLevel(raw);
        setAudioLevel(level);

        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (error) {
      logger.error('Failed to test audio:', error);
      setTestingAudio(false);
    }
  }, [testingAudio, stopAudioTest, getAudioConstraints]);

  const testVideoInput = useCallback(async () => {
    if (testingVideo) {
      stopVideoTest();
      return;
    }

    setTestingVideo(true);
    try {
      const videoConstraints = getVideoConstraints ? getVideoConstraints() : true;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      });

      testStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (error) {
      logger.error('Failed to test video:', error);
      setTestingVideo(false);
    }
  }, [testingVideo, stopVideoTest, getVideoConstraints, videoRef]);

  // Clean up all tests on unmount
  useEffect(() => {
    return () => {
      stopAudioTest();
      stopVideoTest();
    };
  }, [stopAudioTest, stopVideoTest]);

  return {
    testingAudio,
    testingVideo,
    audioLevel,
    rawAudioLevel,
    testAudioInput,
    testVideoInput,
    stopAudioTest,
    stopVideoTest,
  };
}
