import { useState, useEffect, memo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Check, XCircle } from "lucide-react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import {
    FormField, Section, InfoBanner, SelectField,
    inputClassName,
} from "@/components/transcription/FormHelpers";

// ============================================================================
// Types & Constants
// ============================================================================

export interface WhisperXParams {
    model_family: string;
    model: string;
    model_cache_only: boolean;
    model_dir?: string;
    device: string;
    device_index: number;
    batch_size: number;
    compute_type: string;
    threads: number;
    output_format: string;
    verbose: boolean;
    task: string;
    language?: string;
    align_model?: string;
    interpolate_method: string;
    no_align: boolean;
    return_char_alignments: boolean;
    vad_method: string;
    vad_onset: number;
    vad_offset: number;
    chunk_size: number;
    diarize: boolean;
    min_speakers?: number;
    max_speakers?: number;
    diarize_model: string;
    speaker_embeddings: boolean;
    temperature: number;
    best_of: number;
    beam_size: number;
    patience: number;
    length_penalty: number;
    suppress_tokens?: string;
    suppress_numerals: boolean;
    initial_prompt?: string;
    condition_on_previous_text: boolean;
    fp16: boolean;
    temperature_increment_on_fallback: number;
    compression_ratio_threshold: number;
    logprob_threshold: number;
    no_speech_threshold: number;
    max_line_width?: number;
    max_line_count?: number;
    highlight_words: boolean;
    segment_resolution: string;
    hf_token?: string;
    print_progress: boolean;
    attention_context_left: number;
    attention_context_right: number;
    is_multi_track_enabled: boolean;
    api_key?: string;
    max_new_tokens?: number;
}

interface TranscriptionConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStartTranscription: (params: WhisperXParams & { profileName?: string; profileDescription?: string }) => void;
    loading?: boolean;
    isProfileMode?: boolean;
    initialParams?: WhisperXParams;
    initialName?: string;
    initialDescription?: string;
    isMultiTrack?: boolean;
    title?: string;
}

const DEFAULT_PARAMS: WhisperXParams = {
    model_family: "openai",
    model: "whisper-1",
    model_cache_only: false,
    device: "cpu",
    device_index: 0,
    batch_size: 8,
    compute_type: "float32",
    threads: 0,
    output_format: "all",
    verbose: true,
    task: "transcribe",
    interpolate_method: "nearest",
    no_align: false,
    return_char_alignments: false,
    vad_method: "pyannote",
    vad_onset: 0.5,
    vad_offset: 0.363,
    chunk_size: 30,
    diarize: false,
    diarize_model: "pyannote",
    speaker_embeddings: false,
    temperature: 0,
    best_of: 5,
    beam_size: 5,
    patience: 1.0,
    length_penalty: 1.0,
    suppress_numerals: false,
    condition_on_previous_text: false,
    fp16: true,
    temperature_increment_on_fallback: 0.2,
    compression_ratio_threshold: 2.4,
    logprob_threshold: -1.0,
    no_speech_threshold: 0.6,
    highlight_words: false,
    segment_resolution: "sentence",
    print_progress: false,
    attention_context_left: 256,
    attention_context_right: 256,
    is_multi_track_enabled: false,
    api_key: "",
};

const LANGUAGES = [
    { value: "auto", label: "Auto-detect" },
    { value: "af", label: "Afrikaans" },
    { value: "ar", label: "Arabic" },
    { value: "hy", label: "Armenian" },
    { value: "az", label: "Azerbaijani" },
    { value: "be", label: "Belarusian" },
    { value: "bs", label: "Bosnian" },
    { value: "bg", label: "Bulgarian" },
    { value: "ca", label: "Catalan" },
    { value: "zh", label: "Chinese" },
    { value: "hr", label: "Croatian" },
    { value: "cs", label: "Czech" },
    { value: "da", label: "Danish" },
    { value: "nl", label: "Dutch" },
    { value: "en", label: "English" },
    { value: "et", label: "Estonian" },
    { value: "fi", label: "Finnish" },
    { value: "fr", label: "French" },
    { value: "gl", label: "Galician" },
    { value: "de", label: "German" },
    { value: "el", label: "Greek" },
    { value: "he", label: "Hebrew" },
    { value: "hi", label: "Hindi" },
    { value: "hu", label: "Hungarian" },
    { value: "is", label: "Icelandic" },
    { value: "id", label: "Indonesian" },
    { value: "it", label: "Italian" },
    { value: "ja", label: "Japanese" },
    { value: "kn", label: "Kannada" },
    { value: "kk", label: "Kazakh" },
    { value: "ko", label: "Korean" },
    { value: "lv", label: "Latvian" },
    { value: "lt", label: "Lithuanian" },
    { value: "mk", label: "Macedonian" },
    { value: "ms", label: "Malay" },
    { value: "mr", label: "Marathi" },
    { value: "mi", label: "Maori" },
    { value: "ne", label: "Nepali" },
    { value: "no", label: "Norwegian" },
    { value: "fa", label: "Persian" },
    { value: "pl", label: "Polish" },
    { value: "pt", label: "Portuguese" },
    { value: "ro", label: "Romanian" },
    { value: "ru", label: "Russian" },
    { value: "sr", label: "Serbian" },
    { value: "sk", label: "Slovak" },
    { value: "sl", label: "Slovenian" },
    { value: "es", label: "Spanish" },
    { value: "sw", label: "Swahili" },
    { value: "sv", label: "Swedish" },
    { value: "tl", label: "Tagalog" },
    { value: "ta", label: "Tamil" },
    { value: "th", label: "Thai" },
    { value: "tr", label: "Turkish" },
    { value: "uk", label: "Ukrainian" },
    { value: "ur", label: "Urdu" },
    { value: "vi", label: "Vietnamese" },
    { value: "cy", label: "Welsh" },
];


// ============================================================================
// Main Component
// ============================================================================

export const TranscriptionConfigDialog = memo(function TranscriptionConfigDialog({
    open,
    onOpenChange,
    onStartTranscription,
    loading = false,
    isProfileMode = false,
    initialParams,
    initialName = "",
    initialDescription = "",
    isMultiTrack = false,
    title,
}: TranscriptionConfigDialogProps) {
    const [params, setParams] = useState<WhisperXParams>(DEFAULT_PARAMS);
    const [profileName, setProfileName] = useState("");
    const [profileDescription, setProfileDescription] = useState("");

    // OpenAI validation state
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
    const [validationMessage, setValidationMessage] = useState("");
    const { getAuthHeaders } = useAuth();
    const [availableModels, setAvailableModels] = useState<string[]>(["whisper-1"]);

    // Reset when dialog opens
    useEffect(() => {
        if (open) {
            const baseParams = initialParams || DEFAULT_PARAMS;
            setParams({
                ...baseParams,
                is_multi_track_enabled: isMultiTrack,
                diarize: isMultiTrack ? false : baseParams.diarize
            });
            setProfileName(initialName);
            setProfileDescription(initialDescription);
        }
    }, [open, initialParams, initialName, initialDescription, isMultiTrack]);

    const updateParam = <K extends keyof WhisperXParams>(key: K, value: WhisperXParams[K]) => {
        setParams(prev => ({ ...prev, [key]: value }));
    };

    const validateAPIKey = async () => {
        setIsValidating(true);
        setValidationStatus('idle');
        try {
            const response = await fetch('/api/v1/config/openai/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ api_key: params.api_key }),
            });
            const data = await response.json();
            if (response.ok && data.valid) {
                setValidationStatus('valid');
                setAvailableModels(data.models || ["whisper-1"]);
                setValidationMessage("API key validated");
            } else {
                setValidationStatus('invalid');
                setValidationMessage(data.error || "Invalid API key");
            }
        } catch {
            setValidationStatus('invalid');
            setValidationMessage("Validation failed");
        } finally {
            setIsValidating(false);
        }
    };

    const handleSubmit = () => {
        if (isProfileMode) {
            onStartTranscription({ ...params, profileName, profileDescription });
        } else {
            onStartTranscription(params);
        }
    };

    const dialogTitle = title || (isProfileMode
        ? (initialName ? `Edit "${initialName}"` : "New Transcription Profile")
        : "Transcription Settings"
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-full sm:max-w-2xl w-[calc(100vw-1rem)] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl"
                style={{ boxShadow: 'var(--shadow-float)' }}
            >
                {/* Header */}
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-[var(--border-subtle)]">
                    <DialogTitle className="text-xl font-semibold text-[var(--text-primary)]">
                        {dialogTitle}
                    </DialogTitle>
                    <DialogDescription className="text-[var(--text-secondary)] text-sm mt-1">
                        {isProfileMode
                            ? "Configure and save your transcription settings."
                            : "Choose a model and configure transcription parameters."
                        }
                    </DialogDescription>
                </DialogHeader>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

                    {/* Profile Name/Description (if profile mode) */}
                    {isProfileMode && (
                        <div className="p-4 bg-[var(--bg-main)] rounded-xl border border-[var(--border-subtle)] space-y-4">
                            <FormField label="Profile Name" htmlFor="profileName">
                                <Input
                                    id="profileName"
                                    value={profileName}
                                    onChange={(e) => setProfileName(e.target.value)}
                                    placeholder="My transcription profile"
                                    className={inputClassName}
                                    required
                                />
                            </FormField>
                            <FormField label="Description" htmlFor="profileDesc" optional>
                                <Textarea
                                    id="profileDesc"
                                    value={profileDescription}
                                    onChange={(e) => setProfileDescription(e.target.value)}
                                    placeholder="Describe this profile..."
                                    className={`${inputClassName} resize-none min-h-[80px]`}
                                    rows={2}
                                />
                            </FormField>
                        </div>
                    )}

                    {/* Multi-track notice */}
                    {isMultiTrack && (
                        <InfoBanner variant="info" title="Multi-track Audio Detected">
                            Each audio track will be transcribed separately. Speaker diarization is disabled.
                        </InfoBanner>
                    )}

                    {/* OpenAI Configuration */}
                    <OpenAIConfig
                        params={params} updateParam={updateParam}
                        isValidating={isValidating} validationStatus={validationStatus}
                        validationMessage={validationMessage} availableModels={availableModels}
                        onValidate={validateAPIKey}
                    />
                </div>

                {/* Footer */}
                <DialogFooter className="px-6 py-4 border-t border-[var(--border-subtle)] gap-3 sm:gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-main)] cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={loading || (isProfileMode && !profileName.trim())}
                        className="rounded-xl text-white cursor-pointer bg-gradient-to-r from-[#FFAB40] to-[#FF3D00] hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Starting...
                            </>
                        ) : (
                            isProfileMode ? "Save Profile" : "Start Transcription"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
});

// ============================================================================
// Model-Specific Configuration Components
// ============================================================================

interface ConfigProps {
    params: WhisperXParams;
    updateParam: <K extends keyof WhisperXParams>(key: K, value: WhisperXParams[K]) => void;
    isMultiTrack?: boolean;
}

interface OpenAIConfigProps extends ConfigProps {
    isValidating: boolean;
    validationStatus: 'idle' | 'valid' | 'invalid';
    validationMessage: string;
    availableModels: string[];
    onValidate: () => void;
}

function OpenAIConfig({
    params, updateParam,
    isValidating, validationStatus, validationMessage, availableModels, onValidate
}: OpenAIConfigProps) {
    return (
        <div className="space-y-6">
            <Section title="API Configuration">
                <div className="space-y-4">
                    <FormField label="OpenAI API Key" description="Your API key. Leave empty to use server default if configured.">
                        <div className="flex gap-2">
                            <Input
                                type="password" placeholder="sk-..."
                                value={params.api_key || ""}
                                onChange={(e) => updateParam('api_key', e.target.value)}
                                className={`${inputClassName} flex-1`}
                            />
                            <Button
                                variant="outline" onClick={onValidate} disabled={isValidating}
                                className="shrink-0 rounded-xl border-[var(--border-subtle)] cursor-pointer"
                            >
                                {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate"}
                            </Button>
                        </div>
                        {validationStatus !== 'idle' && (
                            <div className={`flex items-center gap-2 text-sm mt-2 ${validationStatus === 'valid' ? 'text-[var(--success-solid)]' : 'text-[var(--error)]'}`}>
                                {validationStatus === 'valid' ? <Check className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                <span>{validationMessage}</span>
                            </div>
                        )}
                    </FormField>

                    <SelectField label="Model" value={params.model || "whisper-1"} onValueChange={(v) => updateParam('model', v)} options={availableModels} />
                    <SelectField label="Language" value={params.language || "auto"} onValueChange={(v) => updateParam('language', v === "auto" ? undefined : v)} options={LANGUAGES} />
                </div>
            </Section>

            {params.model && params.model !== "whisper-1" && (
                <InfoBanner variant="warning" title="Limited Features">
                    Word-level timestamps are only supported by whisper-1. Synchronized playback won't be available.
                </InfoBanner>
            )}
        </div>
    );
}

