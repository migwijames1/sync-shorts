import { GoogleGenAI, Type, Modality } from "@google/genai";
import { YouTubeMetadata } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// Generates a script that weaves visual descriptions into the narrative flow.
export const generateScriptWithScenes = async (topic: string, sceneDescriptions: string[]): Promise<string> => {
  const ai = getAI();
  const scenesText = sceneDescriptions.map((d, i) => `Scene ${i + 1}: ${d}`).join("\n");
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Task: Create a 35-45 second narrator script for a vertical video about "${topic}".
    
    The video contains these visual artifacts:
    ${scenesText}
    
    CRITICAL: The script MUST vocalize the descriptions of the image artifacts. When an image appears, the narrator should naturally describe its raw, physical essence (e.g., "The texture of the blue ink bleeding into the fibers...").
    
    Tone: Cinematic, raw, human, atmospheric. 
    Avoid AI-cliches. Return ONLY the final script text.`,
  });
  return response.text || "";
};

export const generateScript = async (topic: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Write a cinematic, raw narrator script for: "${topic}". Focus on physical textures and human emotion. Return only the script text.`,
  });
  return response.text || "";
};

export const transcribeAudio = async (audioBase64: string): Promise<string> => {
  const ai = getAI();
  const rawData = audioBase64.split(',')[1] || audioBase64;
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { data: rawData, mimeType: 'audio/mpeg' } },
        { text: "Provide a verbatim transcript of this audio. Return only the text." }
      ]
    }
  });
  return response.text || "";
};

export const generateSceneDescriptions = async (topic: string, script?: string): Promise<string[]> => {
  const ai = getAI();
  const context = script ? `Script: ${script}` : `Topic: ${topic}`;
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze: "${context}". Provide 5 distinct visual prompts. 
    Focus on physical reality: raw film grain, ballpoint pen textures, graphite dust, macro photography.
    Avoid all "AI-generated" symmetry and plastic looks. 
    Return as a JSON array of strings.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });
  return JSON.parse(response.text || "[]");
};

export const generateSceneImage = async (sceneDescription: string, styleIndex: number): Promise<string> => {
  const ai = getAI();
  const styles = [
    "Raw, underexposed 35mm film still, heavy silver halide grain, light leaks, organic imperfections, Kodak Portra 400 aesthetic.",
    "Macro ballpoint pen ink texture, visible paper fibers, uneven ink distribution, smudged fingerprint detail, physical notebook artifact.",
    "Architectural graphite sketch on rough 300gsm paper, charcoal dust, smudged edges, high-contrast analog drawing style.",
    "Authentic polaroid 600, chemical developer artifacts, soft focus, natural motion blur, authentic vintage nostalgia.",
    "Gritty documentary photography, harsh side lighting, 1600 ISO noise, raw human features, non-symmetrical realism."
  ];

  const stylePrompt = styles[styleIndex % styles.length];

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: `Capture: ${sceneDescription}. 
          Medium Style: ${stylePrompt}. 
          MANDATORY: Visually emphasize the material noise and texture. No smooth AI skin. No clean digital lighting. Raw and tactile.`
        },
      ],
    },
    config: {
      imageConfig: { aspectRatio: "9:16" },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
  }
  throw new Error("Visual synthesis failed.");
};

export const analyzeYouTubeVoice = async (url: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze vocal frequency of: ${url}. Return a neural profile for biometric synthesis.`,
    config: { tools: [{ googleSearch: {} }] }
  });
  return response.text || "";
};

export const generateYouTubeMetadata = async (script: string): Promise<YouTubeMetadata> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Based on: "${script}", create viral metadata in JSON.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["title", "description", "tags"]
      }
    }
  });
  return JSON.parse(response.text || "{}");
};

export const generateAudio = async (text: string, voiceSampleBase64: string | null = null, youtubeVoiceProfile: string | null = null): Promise<string> => {
  const ai = getAI();
  const promptText = `Vocalize this text with extreme realism: "${text}". 
  
  CRITICAL VOCAL REQUIREMENTS:
  1. Include natural human artifacts: subtle breaths between sentences, slight hesitations, and realistic emotional inflections.
  2. Vary the pacing: slow down for emphasis, speed up slightly during transitions.
  3. Avoid the "perfect" robotic cadence. It should sound like a raw, high-quality voice memo or a cinematic narrator in a quiet room.
  4. If a voice sample is provided, mimic its specific rasp, tone, and breathing patterns exactly.`;

  if (voiceSampleBase64) {
    const rawData = voiceSampleBase64.split(',')[1] || voiceSampleBase64;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      contents: {
        parts: [
          { inlineData: { data: rawData, mimeType: 'audio/wav' } },
          { text: `${promptText} Match the biometric frequency of the provided sample.` }
        ]
      },
      config: { responseModalities: [Modality.AUDIO] },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: { parts: [{ text: promptText }] },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};
