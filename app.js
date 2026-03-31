// ASTITVA 2.0 - Core Application Logic (app.js)

let appState = {
    userName: "",
    userAge: "",
    userOcc: "",
    matchedScheme: null,
    location: null,
    docsToCheck: [],
    currentDocIndex: 0
};

// ----------------------------------------------------------------------------
// 1. INITIALIZATION & HIJACKING
// ----------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
    fixMobileSpeechSynthesis();
    interceptSwitchView();
    setupButtonLogic();
    checkOnboarding();
});

function requestLocationAccess() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            appState.location = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
        }, (error) => {
            console.log("Location access denied or failed.", error);
        });
    }
}

function checkOnboarding() {
    const savedUser = localStorage.getItem('astitva_user');
    if (savedUser) {
        try {
            const parsed = JSON.parse(savedUser);
            appState.userName = parsed.name || "";
            appState.userAge = parsed.age || "N/A";
            appState.userOcc = parsed.occ || "N/A";
        } catch(e) {}
    }
}

// Routes user intelligently after picking language
function goToNextAfterLanguage(langCode) {
    currentLang = langCode;
    
    // Check if we loaded a valid profile earlier
    if (appState.userName && appState.userName !== "N/A") {
        switchView(3);
    } else {
        switchView(2);
    }
}

// FIX 3: Global handles so any view transition can stop stale audio/mic
let _activeRecognition = null;
let _activeSpeakTimer = null;
let _pendingTimers = []; // Track all pending setTimeout IDs for cleanup
let _speechId = 0; // Prevent canceled speech from triggering its callback
window._activeUtterances = []; // FIX: Prevent Android GC from destroying utterances mid-speech

function cleanSlate() {
    _speechId++; // Discard any pending speech callbacks
    // Cancel any queued or playing TTS immediately
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    // Abort any open microphone session
    if (_activeRecognition) {
        try { _activeRecognition.abort(); } catch(e) {}
        _activeRecognition = null;
    }
    window._activeUtterances = []; // Free memory of past utterances
    // Reset listening guard
    _isListening = false;
    // Clear any pending failsafe timers
    if (_activeSpeakTimer) {
        clearTimeout(_activeSpeakTimer);
        _activeSpeakTimer = null;
    }
    // Clear ALL pending delayed timers (View 1 greetings etc.)
    _pendingTimers.forEach(id => clearTimeout(id));
    _pendingTimers = [];
}

function interceptSwitchView() {
    const originalSwitchView = window.switchView;
    window.switchView = function(viewId) {
        cleanSlate(); // FIX 3: Nuke all stale audio/mic before switching
        originalSwitchView(viewId);
        onViewChanged(viewId);
    };
}

function setupButtonLogic() {
    // NOTE: View 2 mic button is handled dynamically by bindMainMic() inside each flow function.
    // Do NOT add a static listener here - it causes double-firing with bindMainMic's onclick.


    // Hijack View 3 Dashboard Categories
    const view3 = document.getElementById('view-3');
    if(view3) {
        const categoryBtns = view3.querySelectorAll('button.glass-panel');
        if(categoryBtns.length >= 4){
            categoryBtns[0].onclick = (e) => { e.preventDefault(); findSchemeByCategory("Agriculture"); };
            categoryBtns[1].onclick = (e) => { e.preventDefault(); findSchemeByCategory("Health"); };
            categoryBtns[2].onclick = (e) => { e.preventDefault(); findSchemeByCategory("Pension"); };
            categoryBtns[3].onclick = (e) => { e.preventDefault(); findSchemeByCategory("Education"); };
        }
    }

    // Fallback Text Input (Press ~ key)
    document.addEventListener('keydown', (e) => {
        if (e.key === '~' || e.key === '`') {
            const input = prompt("Fallback Input (Type your response):");
            if (input) {
                // Routing based on active view
                const activeViewId = Array.from(document.querySelectorAll('.view-section')).findIndex(v => v.classList.contains('view-active'));
                if (activeViewId === 2) handleNameInput(input);
                else if (activeViewId === 6) handleExpertChat(input);
            }
        }
    });
}

function warmupMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        try {
            const temp = new SpeechRecognition();
            temp.start(); // Triggers the permission prompt
            setTimeout(() => temp.stop(), 500); 
        } catch(e) {}
    }
}

function onViewChanged(viewId) {
    if (viewId === 1) {
        requestLocationAccess();
        warmupMic();

        // Safe robust TTS greeting — tracked so cleanSlate() can kill them if user navigates away
        _pendingTimers.push(setTimeout(() => {
             speak("Namaste! Please choose your language.", () => {}, 'en-IN');
             _pendingTimers.push(setTimeout(() => {
                 speak("తెలుగు కోసం నీలం రంగు బటన్ నొక్కండి.", null, 'te-IN', "Telugu kosam, neelam rangu button nokkandi.");
             }, 3000));
             _pendingTimers.push(setTimeout(() => {
                 speak("हिंदी के लिए नारंगी बटन दबाएँ।", null, 'hi-IN', "Hindi ke liye, naarangee button dabahyein.");
             }, 6500));
        }, 500));
        
    } else if (viewId === 2) {
        // Speak the name question — but do NOT auto-launch listen() inside the callback!
        // Mobile browsers (Android/iOS) BLOCK microphone activation from inside TTS callbacks.
        // The user must tap the mic button manually after hearing the question.
        const nameQ = currentLang === 'te' ? "మీ పేరు ఏమిటి?" : "आपकా नाम क्या है?";
        const nameQPhonetic = currentLang === 'te' ? "Mee peru ay-mi-ti?" : "Aapka naam kya hai?";
        speak(nameQ, null, null, nameQPhonetic);
        // Wire up the mic button so the user can tap when ready
        bindMainMic(() => listenForName());
    } else if (viewId === 3) {
        const h2 = document.querySelector('#view-3 h2');
        if(h2) h2.innerText = currentLang === 'te' ? `నమస్కారం, ${appState.userName}!` : `नमस्ते, ${appState.userName}!`;
        speak(currentLang === 'te' ? `${appState.userName}, ఈరోజు మీకు ఏ మార్గదర్శకత్వం కావాలి?` : `${appState.userName}, आज आपको क्या मदद चाहिए?`, null, null, currentLang === 'te' ? `${appState.userName}, Ee-roju meku ye sahaayam kaavali?` : `${appState.userName}, aaj aapko kya madad chahiye?`);
        // View 4 speech is now entirely dictated by Gemini RAG engine in renderRecommendedSchemes. No hardcoded override here.
        // Wait for renderRecommendedSchemes to trigger speak().
    } else if (viewId === 6) {
        speak(currentLang === 'te' 
            ? "నమస్తే! మేము మీ స్థానిక సహాయకులము. మీకు ఇంకేమైనా సహాయం కావాలంటే దయచేసి మమ్మల్ని సంప్రదించండి." 
            : "नमस्ते! हम आपके स्थानीय सहायक हैं। यदि आपको किसी और सहायता की आवश्यकता है, तो हमसे संपर्क करें।", null, null, 
            currentLang === 'te' ? "Namaste! Memu mee sthanika sahayakulamu. Meeku sahayam kaavaalanteమమ్మల్ని sampradinchandi." : "Namaste! Hum aapke sthaniya sahayak hain. Kisi sahayata ke liye humse sampark karein.");
    }
}

// ----------------------------------------------------------------------------
// 2. LOGIC ROUTERS
// ----------------------------------------------------------------------------

function sanitizePhonetic(txt) {
    if (!txt) return "";
    // If it contains non-English letters (like Telugu/Hindi), return blank so TTS doesn't freeze
    if (/[^\x00-\x7F]/.test(txt)) return "";
    return txt;
}

function bindMainMic(callback) {
    let btn = document.getElementById("main-mic-btn");
    if(btn) btn.onclick = callback;
}

function listenForName() {
    // Reset any active mic or TTS so tapping to retry is clean
    if (_activeRecognition) { try { _activeRecognition.abort(); } catch(e){} _activeRecognition=null; }
    _isListening = false;
    _speechId++;

    let hl = document.getElementById("mic-headline");
    let st = document.getElementById("mic-status");
    if(hl) hl.innerText = currentLang === 'te' ? "మీ పేరు ఏమిటి?" : "आपका नाम क्या है?";
    if(st) st.innerText = "Listening...";
    
    bindMainMic(() => listenForName());
    
    listen((transcript) => {
        if(transcript) {
            let safeName = sanitizePhonetic(transcript);
            let pTe = safeName ? `Mee peru ${safeName} ye-na? Avunu leda kaadu ani cheppandi.` : `Idi sarainadena? Avunu leda kaadu ani cheppandi.`;
            let pHi = safeName ? `Kya aapka naam ${safeName} hai? Haan ya na kahein.` : `Kya yeh sahi hai? Haan ya na kahein.`;
            
            confirmInput({
                title: currentLang === 'te' ? `మీ పేరు ${transcript} యేనా?` : `क्या आपका नाम ${transcript} है?`,
                status: currentLang === 'te' ? "అవును లేదా కాదు చెప్పండి" : "हाँ या ना कहें",
                speech: currentLang === 'te' ? `మీ పేరు ${transcript} యేనా? అవును లేదా కాదు అని చెప్పండి.` : `क्या आपका नाम ${transcript} है? हाँ या ना कहें।`,
                phonetic: currentLang === 'te' ? pTe : pHi
            }, () => {
                appState.userName = transcript;
                askAgeFlow();
            }, () => {
                speak(currentLang === 'te' ? "సరే, దయచేసి మీ పేరు మళ్ళీ చెప్పండి." : "ठीक है, कृपया अपना नाम फिर से कहें।", () => listenForName());
            });
        } else {
            // Did not hear anything - Wait for manual click instead of endless looping!
            if(st) st.innerText = currentLang === 'te' ? "వినపడలేదు. మైక్ టాప్ చేయండి." : "सुनाई नहीं दिया। माइक टैप करें।";
        }
    });
}

let _isListening = false; // Guard against double-call race conditions

function listen(callback) {
    if (_isListening) {
        console.warn("[listen] Already listening — ignoring double-call.");
        return;
    }
    _isListening = true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Your browser does not support Voice Recognition.");
        callback("");
        return;
    }

    const recognition = new SpeechRecognition();
    if(currentLang === 'te') recognition.lang = 'te-IN';
    else if(currentLang === 'hi') recognition.lang = 'hi-IN';
    else recognition.lang = 'en-IN';
    
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    recognition.continuous = false;
    // On mobile, interimResults can cause the Android Chrome hang bug where partial results
    // never fire isFinal=true. Disable it on mobile for reliability.
    recognition.interimResults = !isMobile;

    // Track globally so cleanSlate() can abort this from outside
    _activeRecognition = recognition;

    // Extended to 12s on mobile to give it time to warm up the mic permission
    const watchdogMs = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 12000 : 7000;
    let watchdogTimer = setTimeout(() => {
        if (!finished) {
            console.warn("[Watchdog] Mic hung for " + watchdogMs/1000 + "s. Force-stopping.");
            finished = true;
            _isListening = false;
            try { recognition.stop(); } catch(e) {}
            _activeRecognition = null;
            callback(lastInterim || "");
        }
    }, watchdogMs);

    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
        oscillator.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
    } catch(e) {}

    let finished = false;

    let lastInterim = '';
    let interimTimer = null;

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        let transElement = document.getElementById("mic-transcript");
        if(transElement) {
             transElement.innerText = finalTranscript || interimTranscript || "Listening...";
        }

        // Accept final transcript immediately
        if (finalTranscript && !finished) {
            if(interimTimer) clearTimeout(interimTimer);
            finished = true;
            _isListening = false;
            clearTimeout(watchdogTimer);
            _activeRecognition = null;
            recognition.stop();
            callback(finalTranscript.trim());
            return;
        }

        // Interim-as-final: if Chrome never fires isFinal (common on te-IN/Windows),
        // promote the last interim result after 1.5s of silence
        if (interimTranscript) {
            lastInterim = interimTranscript.trim();
            if(interimTimer) clearTimeout(interimTimer);
            interimTimer = setTimeout(() => {
                if (!finished && lastInterim) {
                    console.log("[interim-as-final] Promoting:", lastInterim);
                    finished = true;
                    _isListening = false;
                    clearTimeout(watchdogTimer);
                    _activeRecognition = null;
                    try { recognition.stop(); } catch(e) {}
                    callback(lastInterim);
                }
            }, 1500);
        }
    };

    recognition.onerror = (event) => {
        if (event.error !== 'aborted') console.error("Mic error", event.error);
        if(!finished) {
            finished = true;
            _isListening = false;
            clearTimeout(watchdogTimer);
            _activeRecognition = null;
            if (lastInterim) {
                console.log("[onerror] Promoting lastInterim:", lastInterim);
                callback(lastInterim);
            } else {
                callback(""); 
            }
        }
    };

    recognition.onend = () => {
        if(!finished) {
            finished = true;
            _isListening = false;
            clearTimeout(watchdogTimer);
            _activeRecognition = null;
            if (lastInterim) {
                console.log("[onend] Promoting lastInterim:", lastInterim);
                callback(lastInterim);
            } else {
                callback("");
            }
        }
    };

    let transElement = document.getElementById("mic-transcript");
    if(transElement) transElement.innerText = "Listening...";

    recognition.start();
}

function confirmInput(promptData, onConfirm, onReject) {
    let hl = document.getElementById("mic-headline");
    let st = document.getElementById("mic-status");
    let mainMicBtn = document.getElementById("main-mic-btn");
    let yesNoContainer = document.getElementById("yes-no-container");
    let btnYes = document.getElementById("btn-visual-yes");
    let btnNo = document.getElementById("btn-visual-no");

    if(hl) hl.innerText = promptData.title;
    if(st) st.innerText = promptData.status;

    // Show visual YES/NO, Hide mic
    if(mainMicBtn) mainMicBtn.classList.add("hidden");
    if(yesNoContainer) yesNoContainer.classList.remove("hidden");

    const cleanupUI = () => {
        if(mainMicBtn) mainMicBtn.classList.remove("hidden");
        if(yesNoContainer) yesNoContainer.classList.add("hidden");
        if(btnYes) btnYes.onclick = null;
        if(btnNo) btnNo.onclick = null;
    };

    // Kill the active mic session AND pending TTS before moving to the next flow step
    const killActiveMic = () => {
        _speechId++; // Discard pending TTS callbacks
        // Cancel any pending TTS so its onend callback doesn't fire a stale listen()
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (_activeRecognition) {
            try { _activeRecognition.abort(); } catch(e) {}
            _activeRecognition = null;
        }
        _isListening = false;
    };

    const confirmAction = () => { killActiveMic(); cleanupUI(); onConfirm(); };
    const rejectAction = () => { killActiveMic(); cleanupUI(); onReject(); };

    if(btnYes) btnYes.onclick = confirmAction;
    if(btnNo) btnNo.onclick = rejectAction;

    speak(promptData.speech, () => {
        listen((ansTranscript) => {
             const ans = (ansTranscript || "").toLowerCase();
             
             if(!ans) {
                 // Stopped listening. Don't spam TTS. Let them use the visual buttons!
                 if(st) st.innerText = currentLang === 'te' ? "అవును లేదా కాదు నొక్కండి." : "हाँ या ना दबाएं।";
                 return;
             }

             if(ans.includes("yes") || ans.includes("avunu") || ans.includes("haan") || ans.includes("yaa") || ans.includes("yep") || ans.includes("true") || ans.includes("correct") || ans.includes("sare") || ans.includes("ha") || ans.includes("hm")) {
                  confirmAction();
             } 
             else if(ans.includes("no") || ans.includes("kadu") || ans.includes("ledu") || ans.includes("nahi") || ans.includes("false") || ans.includes("tappu") || ans.includes("kaadu") || ans.includes("wrong")) {
                  rejectAction();
             } 
             else {
                  if(st) st.innerText = currentLang === 'te' ? "అర్థం కాలేదు. బటన్ నొక్కండి." : "समझ नहीं आया। बटन दबाएं।";
             }
        });
    }, null, promptData.phonetic);
}

function askAgeFlow() {
    if (_activeRecognition) { try { _activeRecognition.abort(); } catch(e){} _activeRecognition=null; }
    _isListening = false;
    _speechId++;

    let hl = document.getElementById("mic-headline");
    let st = document.getElementById("mic-status");
    if(hl) hl.innerText = currentLang === 'te' ? "మీ వయస్సు ఎంత?" : "आपकी उम्र क्या है?";
    if(st) st.innerText = currentLang === 'te' ? "↓ మైక్ నొక్కండి" : "↓ माइक दबाएं";
    
    // FIX: speak first, wire mic button — do NOT call listen() inside TTS callback
    speak(currentLang === 'te' ? "మీ వయస్సు ఎంత?" : "आपकी उम्र क्या है?",
        null, null,
        currentLang === 'te' ? "Mee vayasu entha?" : "Aapki umra kya hai?");

    bindMainMic(() => {
        if (_isListening) return;
        bindMainMic(() => askAgeFlow()); // rebind to retry
        listen((ageTranscript) => {
            if(ageTranscript) {
                let numMatch = ageTranscript.match(/\d+/);
                let ageStr = ageTranscript.toLowerCase();
                if(ageStr.includes("twenty")) numMatch = ["20"];
                if(ageStr.includes("thirty")) numMatch = ["30"];
                if(ageStr.includes("forty")) numMatch = ["40"];
                if(ageStr.includes("fifty")) numMatch = ["50"];
                if(ageStr.includes("sixty")) numMatch = ["60"];

                if(numMatch) {
                    const extractedAge = numMatch[0];
                    confirmInput({
                        title: currentLang === 'te' ? `మీ వయస్సు ${extractedAge} యేనా?` : `क्या आपकी उम्र ${extractedAge} है?`,
                        status: currentLang === 'te' ? "అవును లేదా కాదు చెప్పండి" : "हाँ या ना कहें",
                        speech: currentLang === 'te' ? `మీ వయస్సు ${extractedAge} యేనా?` : `क्या आपकी उम्र ${extractedAge} है?`,
                        phonetic: currentLang === 'te' ? `Mee vayasu ${extractedAge} ye-na? Avunu leda kaadu ani cheppandi.` : `Kya aapki umra ${extractedAge} hai? Haan ya na kahein.`
                    }, () => {
                        appState.userAge = extractedAge;
                        askOccFlow();
                    }, () => {
                        speak(currentLang === 'te' ? "సరే, దయచేసి మీ వయస్సు మళ్ళీ చెప్పండి." : "ठीक है, कृपया अपनी आयु फिर से कहें।", () => askAgeFlow());
                    });
                } else {
                    speak(currentLang === 'te' ? "దయచేసి మీ వయస్సును కేవలం అంకెల్లో చెప్పండి." : "कृपया अपनी आयु केवल संख्या में बताएं।", () => askAgeFlow());
                }
            } else {
                if(st) st.innerText = currentLang === 'te' ? "వినపడలేదు. మైక్ టాప్ చేయండి." : "सुनाई नहीं दिया। माइक टैप करें।";
            }
        });
    });
}

function askOccFlow() {
    if (_activeRecognition) { try { _activeRecognition.abort(); } catch(e){} _activeRecognition=null; }
    _isListening = false;
    _speechId++;

    let hl = document.getElementById("mic-headline");
    let st = document.getElementById("mic-status");
    if(hl) hl.innerText = currentLang === 'te' ? "మీ వృత్తి ఏమిటి?" : "आप क्या काम करते हैं?";
    if(st) st.innerText = currentLang === 'te' ? "↓ మైక్ నొక్కండి" : "↓ माइक दबाएं";

    // FIX: speak first, wire mic button — do NOT call listen() inside TTS callback
    speak(currentLang === 'te' ? "మీరు ఏమి పని చేస్తారు?" : "आप क्या काम करते हैं?",
        null, null,
        currentLang === 'te' ? "Meerem pani chestaru?" : "Aap kya kaam karte hain?");

    bindMainMic(() => {
        if (_isListening) return;
        bindMainMic(() => askOccFlow());
        listen((occTranscript) => {
            if(occTranscript) {
                let safeOcc = sanitizePhonetic(occTranscript);
                let pTe = safeOcc ? `Mee vrutti ${safeOcc} ye-na? Avunu leda kaadu cheppandi.` : `Idi sarainadena? Avunu leda kaadu ani cheppandi.`;
                let pHi = safeOcc ? `Kya aapka kaam ${safeOcc} hai? Haan ya na kahein.` : `Kya yeh sahi hai? Haan ya na kahein.`;
                
                confirmInput({
                    title: currentLang === 'te' ? `మీ వృత్తి ${occTranscript} యేనా?` : `क्या आपका काम ${occTranscript} है?`,
                    status: currentLang === 'te' ? "అవును లేదా కాదు చెప్పండి" : "हाँ या ना कहें",
                    speech: currentLang === 'te' ? `మీ వృత్తి ${occTranscript} యేనా?` : `क्या आपका काम ${occTranscript} है?`,
                    phonetic: currentLang === 'te' ? pTe : pHi
                }, () => {
                    appState.userOcc = occTranscript;
                    localStorage.setItem('astitva_user', JSON.stringify({ 
                        name: appState.userName, 
                        age: appState.userAge, 
                        occ: appState.userOcc 
                    }));
                    switchView(3);
                }, () => {
                    speak(currentLang === 'te' ? "సరే, దయచేసి మీ వృత్తిని మళ్ళీ చెప్పండి." : "ठीक है, कृपया अपना काम फिर से बताएं।", () => askOccFlow());
                });
            } else {
                if(st) st.innerText = currentLang === 'te' ? "వినపడలేదు. మైక్ టాప్ చేయండి." : "सुनाई नहीं दिया। माइक टैप करें।";
            }
        });
    });
}

// ----------------------------------------------------------------------------
// PROFILE MODAL & USER MANAGEMENT
// ----------------------------------------------------------------------------

function showProfile() {
    const existing = document.getElementById('profile-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'profile-modal';
    modal.className = 'fixed inset-0 z-[9999] flex flex-col items-center justify-center p-4 animate-fadeIn';
    modal.style.background = 'rgba(10,15,26,0.95)';
    modal.style.backdropFilter = 'blur(10px)';

    const profileText = currentLang === 'te' ? 'యూజర్ ప్రొఫైల్' : (currentLang === 'hi' ? 'उपयोगकर्ता प्रोफाइल' : 'User Profile');
    const ageText = currentLang === 'te' ? 'వయస్సు' : (currentLang === 'hi' ? 'आयु' : 'Age');
    const occText = currentLang === 'te' ? 'వృత్తి' : (currentLang === 'hi' ? 'पेशा' : 'Occupation');
    const logoutText = currentLang === 'te' ? 'లాగ్ అవుట్ (రీసెట్)' : (currentLang === 'hi' ? 'लॉग आउट (रीसेट)' : 'Logout & Reset');

    modal.innerHTML = `
      <div class="glass-panel w-full max-w-sm rounded-[2rem] p-6 flex flex-col items-center text-center relative opacity-0 translate-y-4" style="animation: fadeIn 0.3s ease forwards;">
         <button class="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/20 transition-all" onclick="this.parentElement.parentElement.remove()">
            <span class="material-symbols-outlined text-sm">close</span>
         </button>
         
         <div class="w-20 h-20 rounded-full bg-gradient-to-br from-brand-orange to-brand-red flex items-center justify-center mb-3 shadow-[0_0_20px_rgba(251,146,60,0.3)] border-2 border-[#121520]">
             <span class="material-symbols-outlined text-4xl text-white">person</span>
         </div>
         
         <h3 class="text-brand-orange font-bold text-xs uppercase tracking-widest mb-1">${profileText}</h3>
         <h2 class="text-3xl font-black text-white mb-6">${appState.userName}</h2>
         
         <div class="w-full bg-white/5 rounded-2xl p-4 flex flex-col gap-4 mb-6 border border-white/5">
             <div class="flex justify-between items-center border-b border-white/10 pb-3">
                 <div class="flex items-center gap-2 text-gray-400">
                     <span class="material-symbols-outlined text-[18px]">cake</span>
                     <span class="font-medium text-sm">${ageText}:</span>
                 </div>
                 <span class="text-white font-bold text-lg">${appState.userAge}</span>
             </div>
             
             <div class="flex justify-between items-center">
                 <div class="flex items-center gap-2 text-gray-400">
                     <span class="material-symbols-outlined text-[18px]">work</span>
                     <span class="font-medium text-sm">${occText}:</span>
                 </div>
                 <span class="text-white font-bold text-lg">${appState.userOcc}</span>
             </div>
         </div>
         
         <button onclick="localStorage.removeItem('astitva_user'); localStorage.removeItem('astitva_lang'); location.reload();" class="w-full py-4 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 font-bold hover:bg-red-500 hover:border-red-500 hover:text-white transition-all hover:shadow-[0_0_15px_rgba(239,68,68,0.4)] flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-[20px]">logout</span> ${logoutText}
         </button>
      </div>
    `;
    document.body.appendChild(modal);
}

function startGeminiVoiceSearch() {
    if (_isListening) return; // Prevent spam-clicking from triggering multiple listen() attempts

    const pulse = document.getElementById('gemini-mic-pulse');
    const status = document.getElementById('gemini-mic-status');
    const btn = document.getElementById('gemini-mic-btn');
    
    // UI Feedback
    if(pulse) pulse.classList.remove('hidden');
    if(status) status.innerText = currentLang === 'te' ? "వింటున్నాను... మాట్లాడండి" : (currentLang === 'hi' ? "सुन रहा हूँ... बोलिए" : "Listening... speak now");
    if(btn) btn.classList.add('border-green-500');

    listen(async (transcript) => {
        // Reset UI
        if(pulse) pulse.classList.add('hidden');
        if(btn) btn.classList.remove('border-green-500');
        
        if (!transcript) {
            // Confusion Handler
            if(status) status.innerText = "Tap to speak your needs";
            const errSpeech = currentLang === 'te' ? "క్షమించండి, నాకు అర్థం కాలేదు. దయచేసి మళ్లీ చెప్పండి." : "क्षमा करें, मुझे समझ नहीं आया। कृपया फिर से कहें।";
            const errPhonetic = currentLang === 'te' ? "Kshaminchandi, naaku artham kaaledu. Daya chesi malli cheppandi." : "Kshama karein, mujhe samajh nahi aaya. Kripaya phir se kahein.";
            speak(errSpeech, null, null, errPhonetic);
            return;
        }

        if(status) status.innerText = currentLang === 'te' ? "వెతుకుతున్నాను..." : "खोज रहा हूँ...";
        
        try {
            // KEY GUARD: Show setup overlay if no key
            const injectedKey = localStorage.getItem('astitva_api_key');
            if (!injectedKey) {
                if(status) status.innerText = "Tap to speak your needs";
                const overlay = document.getElementById('key-setup-overlay');
                if (overlay) overlay.style.display = 'flex';
                speak(currentLang === 'te' ? "దయచేసి API కీ సెటప్ చేయండి." : "Please set up your API key.", null, null, "Please set up your API key in the setup screen.");
                return;
            }

            // FAST PATH: Use local API key directly - bypass all dead Netlify servers
            if (injectedKey) {
                const data = await callGeminiDirect({
                    query: transcript,
                    lang: currentLang,
                    profile: { name: appState.userName, age: appState.userAge, occ: appState.userOcc },
                    db: astitva_db,
                    mode: 'rag'
                });
                
                if(status) status.innerText = "Tap to speak your needs";
                renderRecommendedSchemes(data.scheme_ids || [], data.speech, data.speech_phonetic);
                return;
            }

            const res = await fetch('/.netlify/functions/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: transcript,
                    lang: currentLang,
                    profile: { name: appState.userName, age: appState.userAge, occ: appState.userOcc },
                    db: astitva_db
                })
            });

            if(!res.ok) throw new Error("API failed");
            const data = await res.json();
            
            if(status) status.innerText = "Tap to speak your needs";
            
            // Pass the returned RAG data to rendering pipeline
            renderRecommendedSchemes(data.scheme_ids || [], data.speech, data.speech_phonetic);
            
        } catch(e) {
            console.warn("Netlify failed, retrying direct Gemini...", e);
            // DIRECT FALLBACK: call Gemini API from the browser when on localhost
            try {
                const data = await callGeminiDirect({
                    query: transcript,
                    lang: currentLang,
                    profile: { name: appState.userName, age: appState.userAge, occ: appState.userOcc },
                    db: astitva_db,
                    mode: 'rag'
                });
                if(status) status.innerText = "Tap to speak your needs";
                renderRecommendedSchemes(data.scheme_ids || [], data.speech, data.speech_phonetic);
            } catch(e2) {
                console.error("Direct API Fallback Failed - RAG:", e2);
                if(status) status.innerText = "Tap to speak your needs";
                const errSpeech = currentLang === 'te' ? 'ఇంటర్నెట్ లోపం ఉంది, దయచేసి మళ్లీ ప్రయత్నించండి.' : 'नेटवर्क त्रुटि।';
                speak(errSpeech, null, null, currentLang === 'te' ? 'Internet lopam undi.' : 'Network truti.');
            }
        }
    });
}

function findSchemeByCategory(cat) {
    if(typeof astitva_db === 'undefined') return alert("Database not loaded.");
    const scheme = astitva_db.find(s => s.category.toLowerCase() === cat.toLowerCase()) || astitva_db[0];
    const speech = currentLang === 'te' 
        ? `నేను మీ కోసం ${scheme.name_te} పథకాన్ని కనుగొన్నాను. ఇది ${scheme.benefit_te} ఇస్తుంది.`
        : `मुझे आपके लिए ${scheme.name_hi} योजना मिली है।`;
        
    const phonetic = currentLang === 'te' 
        ? `Nenu mee kosam pathakanni kanugonnanu.`
        : `Mujhe aapke liye yojana mili hai.`;
    
    // Use the exact same RAG renderer for legacy button clicks
    renderRecommendedSchemes([scheme.id], speech, phonetic);
}

function renderRecommendedSchemes(ids, speech, phonetic) {
    const container = document.getElementById('gemini-results-container');
    if(!container) return;
    container.innerHTML = "";
    
    if(!ids || ids.length === 0) {
        container.innerHTML = `<p class="text-white text-center mt-10">No matching schemes found.</p>`;
        switchView(4);
        if(speech) speak(speech, null, null, phonetic);
        return;
    }
    
    const schemesToRender = ids.map(id => astitva_db.find(s => s.id === id)).filter(Boolean);
    if(schemesToRender.length === 0) return;
    
    appState.matchedScheme = schemesToRender[0]; // Set default for flow continuation

    // Render Gemini Array dynamically
    schemesToRender.forEach((scheme, index) => {
        const title = currentLang === 'te' ? scheme.name_te : (currentLang === 'hi' ? scheme.name_hi : scheme.name);
        const benefit = currentLang === 'te' ? scheme.benefit_te : (currentLang === 'hi' ? scheme.benefit_hi : scheme.benefit);
        
        const card = document.createElement('div');
        card.className = "stagger-card bg-white/5 rounded-3xl p-5 border border-white/10 relative overflow-hidden group mb-2 shadow-lg";
        card.style.animationDelay = `${index * 0.15}s`;
        card.innerHTML = `
            <div class="absolute inset-0 bg-brand-orange/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="flex items-start gap-4 mb-4 relative z-10">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
                    <span class="material-symbols-outlined text-white text-2xl">${scheme.icon || 'star'}</span>
                </div>
                <div>
                    <h3 class="text-xl font-bold text-white leading-tight mb-1">${title}</h3>
                    <span class="px-2 py-0.5 bg-white/10 text-brand-orange text-[10px] font-bold rounded uppercase">${scheme.category}</span>
                </div>
            </div>
            <div class="bg-black/20 rounded-xl p-3 mb-4 relative z-10">
                <p class="text-sm text-gray-300 font-medium">${benefit}</p>
            </div>
            <div class="flex gap-2 relative z-10">
                <button class="flex-1 bg-gradient-to-r from-brand-orange to-brand-red font-bold text-white shadow-lg py-3 rounded-xl mb-1 text-sm" onclick='startDocumentCheckFlow(${JSON.stringify(scheme).replace(/'/g, "&apos;")})'>
                    ${currentLang === 'te' ? 'పత్రాలను తనిఖీ చేయండి' : (currentLang === 'hi' ? 'तैयारी करें' : 'Check Requirements')}
                </button>
            </div>
        `;
        container.appendChild(card);
    });
    
    switchView(4);
    if(speech) speak(speech, null, null, phonetic);
}

async function handleExpertChat(query) {
    const chatContainer = document.querySelector('#view-6 .overflow-y-auto');
    if(!chatContainer) return;

    // Add user message
    const div = document.createElement('div');
    div.className = "flex gap-2 max-w-[85%] self-end flex-row-reverse animate-fadeIn";
    div.innerHTML = `
        <div class="bg-gradient-to-br from-brand-orange to-brand-red rounded-2xl rounded-tr-sm px-4 py-3 shadow-[0_0_15px_rgba(251,146,60,0.3)]">
            <p class="text-xs text-white leading-relaxed font-medium">${query}</p>
        </div>
    `;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Show loading indicator
    const reqCtx = appState.matchedScheme ? `User is asking about ${appState.matchedScheme.name}. User query: ${query}` : query;
    
    try {
        // FAST PATH: If local API key exists, bypass dead Netlify backend
        const injectedKey = localStorage.getItem('astitva_api_key');
        if (injectedKey) {
            const data = await callGeminiDirect({
                messages: reqCtx,
                lang: currentLang,
                mode: 'chat'
            });
            appendBotReply(chatContainer, data.reply, data.reply_phonetic || "");
            return;
        }

        // Send to Netlify Function
        const res = await fetch('/.netlify/functions/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: reqCtx, lang: currentLang })
        });
        
        if (!res.ok) throw new Error("Offline or Local");
        
        const data = await res.json();
        const phonetic = data.reply_phonetic || "";
        appendBotReply(chatContainer, data.reply, phonetic);
        
    } catch(err) {
        console.warn("Netlify failed, retrying direct Gemini...", err);
        try {
            const data = await callGeminiDirect({
                messages: reqCtx,
                lang: currentLang,
                mode: 'chat'
            });
            appendBotReply(chatContainer, data.reply, data.reply_phonetic || "");
        } catch(e2) {
            console.error("Direct API Fallback Failed - Chat:", e2);
            const fallback = currentLang === 'te' ? "నేను మీకు సహాయం చేస్తాను." : "मैं निश्चित रूप से आपकी मदद करूंगी।";
            appendBotReply(chatContainer, fallback + " (Offline Mode)", currentLang === 'te' ? "Nenu meku sahayam chestanu." : "");
        }
    }
}

// Direct browser-side Gemini API call (fallback when Netlify is not available)
// NOTE: Only works locally if you pass ?key=YOUR_KEY in the URL to store it in localStorage
// On Netlify this function is never reached because the serverless function handles it.
async function callGeminiDirect({ query, messages, lang, profile, db, mode }) {
    // Safely read key from local storage (injected via URL) — never hardcode it here
    const API_KEY = localStorage.getItem('astitva_api_key');

    if (!API_KEY) {
        throw new Error("No local API key. Deploy to Netlify for full AI features.");
    }

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    const uLang = lang === 'te' ? 'Telugu' : (lang === 'hi' ? 'Hindi' : 'English');
    const pName = profile?.name || appState.userName || "User";
    const pAge  = profile?.age  || appState.userAge  || "Unknown";
    const pOcc  = profile?.occ  || appState.userOcc  || "Unknown";

    let sysInstruction, contentText;

    if (mode === 'rag') {
        sysInstruction = `You are Disha, an expert Indian Government welfare scheme recommender for rural, non-literate users.
The user's spoken language is: ${uLang}.
User Profile: Name: ${pName}, Age: ${pAge}, Occupation: ${pOcc}.
Database of schemes: ${JSON.stringify((db || []).slice(0, 20))}.

TASK: Match problem against EXACT schemes from DB. Do not invent. Speak strictly in ${uLang}. Order by highest priority.
Structure speech: 1) Explain top scheme and its exact benefit. 2) Explain other schemes. 3) Ask which one they want to proceed with.
Return ONLY valid JSON:
{ "speech": "Empathetic conversational answer in ${uLang} script correctly structured.", "speech_phonetic": "Same structured answer in Latin script", "scheme_ids": ["ID1"] }`;
        contentText = "Query: " + (query || "");
    } else {
        sysInstruction = `You are Disha, a helpful local rural scheme expert. Be extremely empathetic and concise. No markdown.
The user's spoken language is: ${uLang}.
TASK: Answer the question. Return ONLY valid JSON:
{ "reply": "Concise empathetic answer in ${uLang} script", "reply_phonetic": "Same in Latin script" }`;
        contentText = "Message: " + (messages || "");
    }

    const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: sysInstruction }] },
            contents: [{ parts: [{ text: contentText }] }],
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
        })
    });

    const raw = await res.json();
    if (raw.error) throw new Error(raw.error.message);
    let text = raw.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    
    // Clean markdown blocks (```json ... ```)
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    return JSON.parse(text);
}

function appendBotReply(container, replyText, replyPhonetic) {
    const botDiv = document.createElement('div');
    botDiv.className = "flex gap-2 max-w-[85%] animate-fadeIn";
    botDiv.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-brand-orange/20 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
            <span class="material-symbols-outlined text-brand-orange text-sm">support_agent</span>
        </div>
        <div class="glass-btn rounded-2xl rounded-tl-sm px-4 py-3">
            <p class="text-xs text-gray-200 leading-relaxed">${replyText}</p>
        </div>
    `;
    container.appendChild(botDiv);
    container.scrollTop = container.scrollHeight;
    speak(replyText, null, null, replyPhonetic);
}

// Old mock logic removed


// ----------------------------------------------------------------------------
// 3. VOICE ENGINE (USING EXACT PROMPT LOGIC)
// ----------------------------------------------------------------------------

function speakEnglish(text, onEndCallback) {
    if (!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-IN';
    if(onEndCallback) utter.onend = onEndCallback;
    window.speechSynthesis.speak(utter);
}

// Ensure voices load early in Chrome
if(window.speechSynthesis) {
    console.log("SpeechSynthesis API Detected. Force loading voices...");
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
        console.log("Voices loaded:", window.speechSynthesis.getVoices().length);
    };
}

function speak(textNative, onEndCallback, forceLang = null, textPhonetic = null) {
    if (!window.speechSynthesis) {
        if (onEndCallback) onEndCallback();
        return;
    }
    try {
        // FIX 1A: Track speech sessions to avoid duplicate callbacks if cut off
        _speechId++;
        const myId = _speechId;
        window.speechSynthesis.cancel();

        let targetLang = forceLang || (currentLang === 'te' ? 'te-IN' : (currentLang === 'hi' ? 'hi-IN' : 'en-IN'));
        
        const utter = new SpeechSynthesisUtterance();
        utter.lang = targetLang;
        utter.rate = 0.85;

        const voices = window.speechSynthesis.getVoices();
        let finalVoice = null;
        let finalSpeakingText = textNative;

        if (voices.length > 0) {
            const langPrefix = targetLang.split('-')[0];
            finalVoice = voices.find(v => v.name.includes("Google") && v.lang.startsWith(langPrefix)) || voices.find(v => v.lang.startsWith(langPrefix));
            
            if(!finalVoice) {
                finalVoice = voices.find(v => v.lang.includes("en-IN") && v.name.includes("Google")) || voices.find(v => v.lang.includes("en-IN") || v.lang.includes("en-GB")) || voices[0];
                if(textPhonetic) finalSpeakingText = textPhonetic;
            }
            if (finalVoice) utter.voice = finalVoice;
        } else {
            if(textPhonetic) finalSpeakingText = textPhonetic;
        }

        // Android Chrome cuts off speech strictly at 15 seconds.
        // FIX: Split long speech into sentence chunks and queue them sequentially, including commas and newlines.
        const chunks = finalSpeakingText.match(/[^.,!?।\n]+[.,!?।\n]*/g) || [finalSpeakingText];
        let currentChunkIndex = 0;

        // FIX 1B: Failsafe timeout — if browser drops the onend event, proceed anyway
        // Increased multiplier significantly because Telugu/Hindi phonetics take longer
        const totalTimeoutMs = (finalSpeakingText.length * 200) + 10000;
        
        let callbackFired = false;
        const safeCallback = () => {
            if (callbackFired || myId !== _speechId) return; // Prevent fired or cancelled speech
            callbackFired = true;
            if (_activeSpeakTimer) { clearTimeout(_activeSpeakTimer); _activeSpeakTimer = null; }
            if (onEndCallback) onEndCallback();
        };

        if (onEndCallback) {
            _activeSpeakTimer = setTimeout(safeCallback, totalTimeoutMs);
        }

        const speakNextChunk = () => {
            if (myId !== _speechId || callbackFired) return;
            
            if (currentChunkIndex >= chunks.length) {
                // Done speaking all chunks
                if (onEndCallback) safeCallback();
                return;
            }

            const chunkText = chunks[currentChunkIndex].trim();
            if (!chunkText) {
                currentChunkIndex++;
                speakNextChunk();
                return;
            }

            const utter = new SpeechSynthesisUtterance(chunkText);
            utter.lang = targetLang;
            utter.rate = 0.85;
            if (finalVoice) utter.voice = finalVoice;

            utter.onend = () => {
                currentChunkIndex++;
                speakNextChunk();
            };
            
            utter.onerror = () => {
                // Continue to next chunk even if one chunk errors
                currentChunkIndex++;
                speakNextChunk();
            };

            // FIX: Pin utterance to window so Android Garbage Collector doesn't delete it before onend fires
            window._activeUtterances.push(utter);
            window.speechSynthesis.speak(utter);
        };

        // Start speaking the first chunk
        speakNextChunk();
        
    } catch(err) {
        if (onEndCallback) onEndCallback();
    }
}

function fixMobileSpeechSynthesis() {
    setInterval(() => {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        }
    }, 10000);
}


// ----------------------------------------------------------------------------
// 4. VIRTUAL DOCUMENT DISPLAY 
// ----------------------------------------------------------------------------

function startDocumentCheckFlow(scheme) {
    if (!scheme || !scheme.docs || scheme.docs.length === 0) {
        switchView(6);
        return;
    }
    appState.docsToCheck = scheme.docs; // e.g. ["Aadhaar", "Ration Card"]
    appState.currentDocIndex = 0;
    checkNextDocument();
}

function checkNextDocument() {
    if (appState.currentDocIndex >= appState.docsToCheck.length) {
        // All documents present
        const successSpeech = currentLang === 'te' 
            ? "అద్భుతం! మీకు అన్ని పత్రాలు ఉన్నాయి. ఇప్పుడు నిపుణుడిని సంప్రదించండి."
            : "बहुत अच्छा! आपके पास सभी दस्तावेज हैं। अब विशेषज्ञ से संपर्क करें।";
        speak(successSpeech, () => {
            switchView(6);
        });
        return;
    }
    const docName = appState.docsToCheck[appState.currentDocIndex];
    showDocumentModal(docName);
}

function getLocalizedDocName(docName) {
    if(currentLang === 'te') {
        const idx = appState.matchedScheme.docs.indexOf(docName);
        return idx > -1 && appState.matchedScheme.docs_te ? appState.matchedScheme.docs_te[idx] : docName;
    } else if(currentLang === 'hi') {
        const idx = appState.matchedScheme.docs.indexOf(docName);
        return idx > -1 && appState.matchedScheme.docs_hi ? appState.matchedScheme.docs_hi[idx] : docName;
    }
    return docName;
}

function showDocumentModal(docName) {
    const existing = document.getElementById('doc-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'doc-modal';
    modal.className = 'fixed inset-0 z-[9999] flex flex-col items-center justify-center p-4 animate-fadeIn';
    modal.style.background = 'rgba(18,21,32,0.92)'; // Using Navy Dark
    modal.style.backdropFilter = 'blur(10px)';

    const docTitle = currentLang === 'te'
      ? `పత్రం ${appState.currentDocIndex + 1} / ${appState.docsToCheck.length}`
      : `Document ${appState.currentDocIndex + 1} of ${appState.docsToCheck.length}`;

    const locDoc = getLocalizedDocName(docName);
    const question = currentLang === 'te'
      ? `మీ దగ్గర ${locDoc} ఉందా?`
      : `क्या आपके पास ${locDoc} है?`;

    modal.innerHTML = `
      <div class="w-full max-w-sm flex flex-col items-center gap-6">
        <p class="text-gray-400 text-sm font-semibold">${docTitle}</p>
        ${getDocumentCardHTML(docName)}
        <h2 class="text-white text-2xl font-black text-center">${question}</h2>
        <div class="flex flex-col gap-4 w-full">
          <button id="doc-yes-btn"
            class="w-full py-5 rounded-3xl font-black text-2xl text-white flex items-center justify-center gap-3 active:scale-[0.98] transition-transform"
            style="background: linear-gradient(135deg, #22c55e, #16a34a);">
            ✅ ${currentLang === 'te' ? 'అవును — ఉంది' : 'हाँ — है'}
          </button>
          <button id="doc-no-btn"
            class="w-full py-5 rounded-3xl font-black text-2xl text-white flex items-center justify-center gap-3 active:scale-[0.98] transition-transform"
            style="background: linear-gradient(135deg, #ef4444, #dc2626);">
            ❌ ${currentLang === 'te' ? 'లేదు — లేదు' : 'नहीं — नहीं'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    
    // Speak the question with phonetic fallback for devices without Indian voices
    const questionPhonetic = currentLang === 'te'
        ? `Mee daggar ${docName} undaa?`
        : `Kya aapke paas ${docName} hai?`;
    speak(question, null, null, questionPhonetic);

    document.getElementById('doc-yes-btn').onclick = () => {
      modal.remove();
      appState.currentDocIndex++;
      checkNextDocument();
    };

    document.getElementById('doc-no-btn').onclick = () => {
      modal.remove();
      showMissingDocHelp(docName);
    };
}

function showMissingDocHelp(docName) {
    let helpText = "";
    if (appState.matchedScheme) {
        if(currentLang === 'te' && appState.matchedScheme.missing_doc_help_te) helpText = appState.matchedScheme.missing_doc_help_te;
        if(currentLang === 'hi' && appState.matchedScheme.missing_doc_help_hi) helpText = appState.matchedScheme.missing_doc_help_hi;
    }
    if (!helpText) {
        helpText = currentLang === 'te' 
            ? "దయచేసి దగ్గరలో ఉన్న మీసేవ కేంద్రం లేదా గ్రామ సచివాలయంలో సహాయం తీసుకోండి."
            : "कृपया अपने निकटतम मीसेवा केंद्र या ग्राम पंचायत कार्यालय में मदद लें।";
    }

    const mapSearch = appState.matchedScheme ? encodeURIComponent(appState.matchedScheme.map_search || "MeeSeva Center near me") : "MeeSeva+Center+near+me";
    const mapUrl = `https://www.google.com/maps/search/${mapSearch}`;

    const helpModal = document.createElement('div');
    helpModal.id = 'help-modal';
    helpModal.className = 'fixed inset-0 z-[9999] flex flex-col items-center justify-center p-4 animate-fadeIn';
    helpModal.style.background = 'rgba(10,15,26,0.98)';

    const howToGetDoc = getMissingDocInstructions(docName, currentLang); 

    helpModal.innerHTML = `
      <div class="w-full max-w-sm flex flex-col gap-5">
        <div class="rounded-3xl p-4 border border-red-500/50" style="background:rgba(239,68,68,0.15)">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-4xl text-brand-red material-symbols-outlined">warning</span>
            <h2 class="text-white font-black text-xl">
              ${currentLang === 'te' ? 'పత్రం లేదు' : 'दस्तावेज नहीं है'}
            </h2>
          </div>
          <p class="text-gray-300 text-sm leading-relaxed font-medium">${helpText}</p>
        </div>

        <div class="rounded-3xl p-4" style="background:rgba(251,146,60,0.15); border: 1px solid rgba(251,146,60,0.4)">
          <h3 class="text-brand-orange font-bold mb-2">
            ${currentLang === 'te' ? 'ఇలా పొందవచ్చు:' : 'ऐसे पाएं:'}
          </h3>
          <p class="text-gray-300 text-sm leading-relaxed">${howToGetDoc}</p>
        </div>

        <a href="${mapUrl}" target="_blank"
          class="w-full py-4 rounded-3xl font-bold text-white text-lg flex items-center justify-center gap-3 shadow-lg hover:scale-105 transition-transform"
          style="background: linear-gradient(135deg, #fb923c, #ef4444);">
          <span class="material-symbols-outlined text-white">map</span> ${currentLang === 'te' ? 'కేంద్రానికి నావిగేట్ చేయండి' : 'केंद्र तक जाएं'}
        </a>

        <button onclick="document.getElementById('help-modal').remove(); startDocumentCheckFlow(appState.matchedScheme);"
          class="w-full py-4 rounded-3xl font-bold text-white text-lg mt-4"
          style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2)">
          ${currentLang === 'te' ? '← తిరిగి వెళ్ళండి' : '← वापस जाएं'}
        </button>
      </div>
    `;

    document.body.appendChild(helpModal);
    
    // Speak both help text and how-to instructions with phonetic fallback
    const fullMessage = helpText + ". " + howToGetDoc;
    const phoneticMessage = currentLang === 'te'
        ? `Mee document ledu. Meeseva kendra ki vellandi sahayam kosam.`
        : `Aapke paas document nahin hai. Nearest Meeseva kendra mein jaayein.`;
    speak(fullMessage, null, null, phoneticMessage);
}

// ----------------------------------------------------------------------------
// 5. MOCKUP GENERATORS
// ----------------------------------------------------------------------------

function getDocumentCardHTML(docName) {
    const lName = docName.toLowerCase();
    const imgStyle = `class="w-full h-auto object-cover rounded-2xl shadow-2xl border-2 border-white/10"`;

    if (lName.includes("aadhaar") || lName.includes("aadhar")) {
        return `<div class="w-full max-w-sm mx-auto rounded-3xl overflow-hidden shadow-2xl">
            <img src="./assets/aadhaar_sample.png" alt="Aadhaar Card" ${imgStyle}
                onerror="this.src='https://via.placeholder.com/600x400/283593/ffffff?text=Aadhaar+Card'" />
        </div>`;
    }

    if (lName.includes("ration")) {
        return `<div class="w-full max-w-sm mx-auto rounded-3xl overflow-hidden shadow-2xl">
            <img src="./assets/ration_card_sample.png" alt="Ration Card" ${imgStyle}
                onerror="this.src='https://via.placeholder.com/600x400/1b5e20/ffffff?text=Ration+Card'" />
        </div>`;
    }

    if (lName.includes("income")) {
        return `<div class="w-full max-w-sm mx-auto rounded-3xl overflow-hidden shadow-2xl">
            <img src="./assets/income_certificate_sample.png" alt="Income Certificate" ${imgStyle}
                onerror="this.src='https://via.placeholder.com/600x400/b71c1c/ffffff?text=Income+Certificate'" />
        </div>`;
    }

    if (lName.includes("caste") || lName.includes("community")) {
        return `<div class="w-full max-w-sm mx-auto rounded-3xl overflow-hidden shadow-2xl">
            <img src="./assets/caste_certificate_sample.png" alt="Caste Certificate" ${imgStyle}
                onerror="this.src='https://via.placeholder.com/600x400/4a148c/ffffff?text=Caste+Certificate'" />
        </div>`;
    }

    if (lName.includes("bank") || lName.includes("passbook") || lName.includes("account")) {
        return `<div class="w-full max-w-sm mx-auto rounded-3xl overflow-hidden shadow-2xl">
            <img src="./assets/bank_passbook_sample.png" alt="Bank Passbook" ${imgStyle}
                onerror="this.src='https://via.placeholder.com/600x400/0d47a1/ffffff?text=Bank+Passbook'" />
        </div>`;
    }

    // Default fallback for any other document
    return `
    <div class="w-full max-w-sm mx-auto bg-blue-900/20 border-2 border-dashed border-blue-500/50 rounded-3xl p-6 text-center shadow-lg">
      <div class="w-16 h-16 rounded-full bg-blue-500/20 text-blue-400 mx-auto flex items-center justify-center mb-4">
        <span class="material-symbols-outlined text-3xl">description</span>
      </div>
      <h3 class="text-white font-black text-xl mb-2">${docName}</h3>
      <p class="text-gray-300 text-sm font-medium">
         ${currentLang === 'te' ? 'దీనికి ఎటువంటి ఫోటో తీయాల్సిన అవసరం లేదు. కేవలం దగ్గర ఉంచుకోండి.' : (currentLang === 'hi' ? 'इसके लिए किसी फोटो की आवश्यकता नहीं है।' : 'No photo required for this document. Just keep it ready.')}
      </p>
    </div>`;
}


function getMissingDocInstructions(docName, lang) {
    const lName = docName.toLowerCase();
    if (lName.includes("aadhaar")) return lang === 'te' ? "ఆధార్ కార్డు పొందడానికి దగ్గరలో ఉన్న మీసేవ కేంద్రానికి వెళ్ళండి." : "आधार कार्ड पाने के लिए नजदीकी मीसेवा केंद्र जाएं।";
    if (lName.includes("ration")) return lang === 'te' ? "రేషన్ కార్డు పొందడానికి గ్రామ సచివాలయానికి వెళ్ళండి." : "राशन कार्ड के लिए ग्राम सचिवालय जाएं।";
    if (lName.includes("income")) return lang === 'te' ? "ఆదాయ ధృవీకరణ పత్రం కోసం మీసేవ కేంద్రానికి వెళ్ళండి." : "आय प्रमाण पत्र के लिए मीसेवा केंद्र जाएं।";
    if (lName.includes("caste")) return lang === 'te' ? "కుల ధృవీకరణ కోసం తహసీల్దార్ కార్యాలయానికి వెళ్ళండి." : "जाति प्रमाण के लिए तहसीलदार कार्यालय जाएं।";
    return lang === 'te' ? "ఈ పత్రం కోసం మీసేవ సెంటర్ ని సంప్రదించండి." : "इस दस्तावेज़ के लिए मीसेवा केंद्र पर जाएँ।";
}

function showHelpers() {
    switchView(6);
    
    // Voice Feedback transitioning from View 5 to View 6
    let message = currentLang === 'te' 
      ? "మీకు ఇంకేమైనా సహాయం కావాలంటే దయచేసి ఈ స్థానిక సహాయకులను సంప్రదించండి." 
      : (currentLang === 'hi' 
         ? "यदि आपको किसी और सहायता की आवश्यकता है, तो कृपया इन स्थानीय सहायकों से संपर्क करें।" 
         : "If you need any further assistance, please contact these local helpers.");
         
    let phonetic = currentLang === 'te' 
      ? "Meeku inka emaina sahayam kavalante dayachesi ee sthanika sahayakulanu sampradinchandi." 
      : (currentLang === 'hi' 
         ? "Yadi aapko kisi aur sahayata ki aavashyakta hai, toh kripaya in sthaniya sahayakon se sampark karein." 
         : null);
         
    speak(message, null, null, phonetic);
}
