document.addEventListener("DOMContentLoaded", function () {

  function logDebug(message) {
    console.log("[DEBUG]:", message);
  }


  /***********************
    SECTION SWITCHING
  ************************/

window.showSection = function (sectionId) {

  document.querySelectorAll(".section").forEach(sec => {
    sec.classList.remove("active");
  });

  document.getElementById(sectionId).classList.add("active");

  if (sectionId === "analytics" && db) {
    loadSessionAnalytics();
  }

  if (sectionId === "book" && db) {
    loadBookMode();
  }
};



  /***********************
    INDEXED DB SETUP
  ************************/

 let db;

function initDB() {

  // Disable buttons until DB is ready
  document.getElementById("startPractice").disabled = true;
  document.getElementById("startExam").disabled = true;
  document.getElementById("startWeakMode").disabled = true;
  document.getElementById("startTodayQuiz").disabled = true;
  document.getElementById("uploadBtn").disabled = true;

const request = indexedDB.open("VocabDB", 4);
  request.onerror = function () {
    logDebug("Database failed to open");
  };

  request.onupgradeneeded = function (event) {
    db = event.target.result;

    // WORDS STORE
    if (!db.objectStoreNames.contains("words")) {
      const wordsStore = db.createObjectStore("words", {
        keyPath: "id",
        autoIncrement: true
      });

      wordsStore.createIndex("word", "word", { unique: true });
      wordsStore.createIndex("batchId", "batchId", { unique: false });
    }

    // SESSIONS STORE
    if (!db.objectStoreNames.contains("sessions")) {
      db.createObjectStore("sessions", {
        keyPath: "id",
        autoIncrement: true
      });
    }

    // PASSAGES STORE
    if (!db.objectStoreNames.contains("passages")) {
      db.createObjectStore("passages", {
        keyPath: "id",
        autoIncrement: true
      });
    }

    logDebug("Database structure created");
  };

request.onsuccess = function () {

  db = request.result;

  // SAFETY CHECK
  if (!db.objectStoreNames.contains("words") ||
      !db.objectStoreNames.contains("sessions")) {

    logDebug("Database structure missing. Rebuilding...");

    db.close();
    indexedDB.deleteDatabase("VocabDB");

    location.reload();
    return;
  }

  logDebug("Database opened successfully");


    // Enable buttons now
    document.getElementById("startPractice").disabled = false;
    document.getElementById("startExam").disabled = false;
    document.getElementById("startWeakMode").disabled = false;
    document.getElementById("startTodayQuiz").disabled = false;
    document.getElementById("uploadBtn").disabled = false;

    // Always refresh analytics once DB is ready
    loadSessionAnalytics();
  };
}

initDB();



  /***********************
    BASIC DB HELPERS
  ************************/

  function addWordToDB(wordObject) {
    const transaction = db.transaction("words", "readwrite");
    const store = transaction.objectStore("words");
    store.add(wordObject);
  }

  function getAllWords(callback) {
    const transaction = db.transaction("words", "readonly");
    const store = transaction.objectStore("words");
    const request = store.getAll();

    request.onsuccess = function () {
      callback(request.result);
    };
  }

  function addSessionToDB(sessionObject, callback) {
  const transaction = db.transaction("sessions", "readwrite");
  const store = transaction.objectStore("sessions");
  const request = store.add(sessionObject);

  request.onsuccess = function () {
    if (callback) callback();
  };
}

// ===== PROCESS PASSAGES FROM SHEET 2 =====
function processPassages(rows, selectedDate) {
  const passageMap = {};

  rows.forEach(row => {
    const title = row.PassageTitle ? row.PassageTitle.trim() : "Untitled Passage";

    if (!passageMap[title]) {
      passageMap[title] = {
        title: title,
        text: row.PassageText ? row.PassageText.trim() : "",
        questions: [],
        createdAt: selectedDate
      };
    }

    // If PassageText only appears in first row, keep it; skip blank overrides
    if (row.PassageText && row.PassageText.trim() && !passageMap[title].text) {
      passageMap[title].text = row.PassageText.trim();
    }

    if (row.Question && row.Question.trim() !== "") {
      passageMap[title].questions.push({
        question: row.Question.trim(),
        optionA: row.OptionA ? String(row.OptionA).trim() : "",
        optionB: row.OptionB ? String(row.OptionB).trim() : "",
        optionC: row.OptionC ? String(row.OptionC).trim() : "",
        optionD: row.OptionD ? String(row.OptionD).trim() : "",
        optionE: row.OptionE ? String(row.OptionE).trim() : "",
        correctAnswer: row.CorrectAnswer
          ? String(row.CorrectAnswer).trim().toUpperCase()
          : "A"
      });
    }
  });

  const tx = db.transaction("passages", "readwrite");
  const store = tx.objectStore("passages");

  Object.values(passageMap).forEach(passage => {
    if (passage.questions.length > 0) {
      store.add(passage);
    }
  });

  tx.oncomplete = function () {
    logDebug("Passages stored: " + Object.keys(passageMap).length);
    const count = Object.keys(passageMap).length;
    document.getElementById("uploadStatus").innerText =
      "Upload successful! Words + " + count + " passage(s) saved.";
  };

  tx.onerror = function () {
    logDebug("Passage storage error");
  };
}




  /***********************
    EXCEL UPLOAD HANDLER
  ************************/

  document.getElementById("uploadBtn").addEventListener("click", function () {
    const fileInput = document.getElementById("excelFile");
    const file = fileInput.files[0];

    if (!file) {
      alert("Please select an Excel file.");
      return;
    }

    if (!db) {
  alert("Database not ready yet. Please refresh.");
  return;
}

    const selectedDateInput = document.getElementById("uploadDateInput").value;

if (!selectedDateInput) {
  alert("⚠️ Please select a date before uploading.");
  return;
}

const [year, month, day] = selectedDateInput.split("-").map(Number);
const selectedDate = new Date(year, month - 1, day);
const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) {
          alert("Excel file is empty or invalid format.");
          return;
        }

// 🔍 DETECT FILE TYPE
const firstRow = jsonData[0];

// ===== PASSAGE FILE =====
if (firstRow.PassageTitle && firstRow.Question) {
  processPassages(jsonData, selectedDate);

  document.getElementById("uploadStatus").innerText =
  "✅ Passage file uploaded successfully!";

loadSessionAnalytics(); // ✅ ADD THIS
document.getElementById("uploadDateInput").value = "";
  return;
}

// ===== VOCAB FILE =====
if (firstRow.Word && firstRow.Meaning) {

  const batchId = new Date().toISOString();
  let addedCount = 0;
  let pending = jsonData.length;
  const transaction = db.transaction("words", "readwrite");
  const store = transaction.objectStore("words");

  jsonData.forEach(row => {

    const mainWord = row.Word ? row.Word.trim().toLowerCase() : "";
    if (!mainWord) {
      pending--;
      return;
    }

    const meanings = row.Meaning
  ? row.Meaning.split(",")
      .map(m => m.trim().toLowerCase())
      .filter(Boolean)
  : [];

const antonyms = row.Antonyms
  ? row.Antonyms.split(",")
      .map(a => a.trim().toLowerCase())
      .filter(Boolean)
  : [];

    const wordObject = {
      word: mainWord,
      meanings: meanings,
      antonyms: antonyms,
      phonetics: row.Phonetics || "",
      note: row.Note || "",
      wrongCount: 0,
      correctCount: 0,
      totalAttempts: 0,
      lastAsked: null,
      reviewInterval: 1,
      nextReviewDate: selectedDate.getTime(),
      batchId: batchId,
      createdAt: selectedDate
    };

    const index = store.index("word");
const request = index.get(mainWord);

request.onsuccess = function () {

  const existing = request.result;

  if (existing) {

    const newMeanings = [...new Set([
      ...(existing.meanings || []),
      ...meanings
    ])];

    const newAntonyms = [...new Set([
      ...(existing.antonyms || []),
      ...antonyms
    ])];

    existing.meanings = newMeanings;
    existing.antonyms = newAntonyms;

    if (!existing.phonetics && row.Phonetics) {
      existing.phonetics = row.Phonetics;
    }

    if (!existing.note && row.Note) {
      existing.note = row.Note;
    }

    store.put(existing);

  } else {

    store.add(wordObject);
    addedCount++;
  }

  // ✅ ADD THIS PART (IMPORTANT)
  pending--;

  if (pending === 0) {
    document.getElementById("uploadStatus").innerText =
      "✅ Vocab uploaded successfully! Words added: " + addedCount;

    loadSessionAnalytics();
    document.getElementById("uploadDateInput").value = "";
  }

};

  });

   

  return;
}

// ❌ INVALID FILE
alert("❌ Invalid Excel format! Check column names.");

        fileInput.value = "";

      } catch (error) {
        logDebug("Excel Processing Error: " + error.message);
      }
    };

    reader.readAsArrayBuffer(file);
  });

let allWordsGlobal = [];
let meaningToWordMap = {};

/***********************
  QUIZ ENGINE
************************/

let currentQuestions = [];
let currentIndex = 0;
let score = 0;
let examMode = false;
let sessionResults = [];

let timerInterval = null;
let timeLeft = 0;
let quizStartTime = 0;
let quizEndTime = 0;



// Start Practice
document.getElementById("startPractice").addEventListener("click", function () {
  const count = parseInt(document.getElementById("practiceCountInput").value);
  startQuiz(count, false);
});
document.getElementById("startWeakMode").addEventListener("click", function () {
  startWeakDrill(20);
});

// Start Today's Quiz
document.getElementById("startTodayQuiz").addEventListener("click", function () {
  startTodayQuiz();
});

// Start Exam
document.getElementById("startExam").addEventListener("click", function () {
startQuiz(50, true);
});

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


// ===== ASSIGN QUESTION TYPES RANDOMLY =====
// Each word gets "meaning" or "antonym" assigned randomly.
// Only assigns "antonym" if the word actually has antonyms stored.
function assignQuestionTypes(questions) {
  return questions.map(q => {
    const hasAntonyms = q.antonyms && q.antonyms.length > 0;
    const type = hasAntonyms && Math.random() < 0.5 ? "antonym" : "meaning";
    return Object.assign({}, q, { questionType: type });
  });
}


function startQuiz(totalQuestions, isExam) {

  if (!db) {
    alert("Database not ready.");
    return;
  }

  getAllWords(function (words) {

    allWordsGlobal = words;

    // ===== BUILD MEANING MAP =====
    meaningToWordMap = {};
    words.forEach(word => {
      word.meanings.forEach(meaning => {
        const key = meaning.toLowerCase();
        if (!meaningToWordMap[key]) {
          meaningToWordMap[key] = [];
        }
        meaningToWordMap[key].push(word.word);
      });
    });

    if (words.length < 5) {
      alert("Not enough words in database.");
      return;
    }

    examMode = isExam;
    score = 0;
    currentIndex = 0;
    sessionResults = [];
    quizStartTime = Date.now();


    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const nowTime = Date.now();

    const dueWords = words.filter(w =>
      !w.nextReviewDate || w.nextReviewDate <= nowTime
    );

    const pool = dueWords.length >= totalQuestions ? dueWords : words;

    // ---- Adaptive Difficulty Engine ----
    const threeDays = 3 * 24 * 60 * 60 * 1000;

    let weak = [];
    let medium = [];
    let strong = [];

    pool.forEach(word => {

      const wrong = word.wrongCount || 0;
      const correct = word.correctCount || 0;
      const lastAsked = word.lastAsked || 0;

      if ((now - lastAsked) > threeDays) {
        medium.push(word);
        return;
      }

      if (wrong > correct) {
        weak.push(word);
      } else if (correct > wrong && correct > 2) {
        strong.push(word);
      } else {
        medium.push(word);
      }
    });

    weak = shuffleArray(weak);
    medium = shuffleArray(medium);
    strong = shuffleArray(strong);

    const weakCount = Math.floor(totalQuestions * 0.5);
    const mediumCount = Math.floor(totalQuestions * 0.3);
    const strongCount = totalQuestions - weakCount - mediumCount;

    let selected = [
      ...weak.slice(0, weakCount),
      ...medium.slice(0, mediumCount),
      ...strong.slice(0, strongCount)
    ];

    if (selected.length < totalQuestions) {
      const remaining = shuffleArray(
        pool.filter(w => !selected.includes(w))
      );
      selected = [
        ...selected,
        ...remaining.slice(0, totalQuestions - selected.length)
      ];
    }

    // ===== ASSIGN RANDOM QUESTION TYPES =====
    currentQuestions = assignQuestionTypes(shuffleArray(selected));

    enterFocusMode();
    renderQuestion();

  });
}

function startWeakDrill(totalQuestions) {

  if (!db) {
    alert("Database not ready.");
    return;
  }

  getAllWords(function (words) {

    allWordsGlobal = words;

    // ===== BUILD MEANING MAP =====
    meaningToWordMap = {};
    words.forEach(word => {
      word.meanings.forEach(meaning => {
        const key = meaning.toLowerCase();
        if (!meaningToWordMap[key]) {
          meaningToWordMap[key] = [];
        }
        meaningToWordMap[key].push(word.word);
      });
    });

    examMode = false;
    score = 0;
    currentIndex = 0;
    sessionResults = [];
    quizStartTime = Date.now();

    // Sort by wrongCount descending
    const sortedByWeakness = [...words]
      .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0));

    const weakestPool = sortedByWeakness.slice(0, 30);
    const shuffled = shuffleArray(weakestPool);
    const selected = shuffled.slice(0, totalQuestions);

    // ===== ASSIGN RANDOM QUESTION TYPES =====
    currentQuestions = assignQuestionTypes(selected);

    enterFocusMode();
    renderQuestion();

  });
}

function startTodayQuiz() {

  if (!db) {
    alert("Database not ready.");
    return;
  }

  getAllWords(function (words) {

    // Filter only words uploaded today (calendar day: 12am to now)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayWords = words.filter(w =>
      new Date(w.createdAt).getTime() >= todayStart.getTime()
    );

    if (todayWords.length === 0) {
      alert("📭 No words uploaded today! Upload today's Excel first.");
      return;
    }

    allWordsGlobal = words;

    // Build meaning map from all words (needed for distractor generation)
    meaningToWordMap = {};
    words.forEach(word => {
      word.meanings.forEach(meaning => {
        const key = meaning.toLowerCase();
        if (!meaningToWordMap[key]) meaningToWordMap[key] = [];
        meaningToWordMap[key].push(word.word);
      });
    });

    examMode = false;
    score = 0;
    currentIndex = 0;
    sessionResults = [];
    quizStartTime = Date.now();

    // Use all of today's words, shuffled
    currentQuestions = assignQuestionTypes(shuffleArray(todayWords));

    enterFocusMode();
    renderQuestion();
  });
}

function renderQuestion() {

  if (currentIndex >= currentQuestions.length) {
    endQuiz();
    return;
  }

  // Clear timer BEFORE wiping container so ghost tick cannot fire on stale element
  clearInterval(timerInterval);
  timerInterval = null;

  const container = document.getElementById("focusContent");
  container.innerHTML = "";

  // ===== EXIT BUTTON =====
  const exitBtn = document.createElement("button");
  exitBtn.innerText = "Exit";
  exitBtn.style.alignSelf = "flex-end";
  exitBtn.style.background = "#444";
  exitBtn.onclick = function () {
    if (confirm("Are you sure you want to exit? Progress will be lost.")) {
      exitFocusMode();
    }
  };
  container.appendChild(exitBtn);

  const question = currentQuestions[currentIndex];
  updateLastAsked(question.id);

  // Progress + Score
  const infoBar = document.createElement("div");
  infoBar.style.marginBottom = "10px";
  infoBar.style.fontWeight = "bold";
  if (examMode) {
    infoBar.innerText = `Question ${currentIndex + 1} / ${currentQuestions.length}`;
  } else {
    infoBar.innerText = `Question ${currentIndex + 1} / ${currentQuestions.length} | Score: ${score.toFixed(2)}`;
  }
  container.appendChild(infoBar);

  // ===== QUESTION TYPE LABEL =====
  const questionTypeLabel = document.createElement("div");
  questionTypeLabel.style.fontWeight = "bold";
  questionTypeLabel.style.fontSize = "0.95em";
  questionTypeLabel.style.marginBottom = "6px";
  questionTypeLabel.style.padding = "4px 10px";
  questionTypeLabel.style.borderRadius = "6px";
  questionTypeLabel.style.display = "inline-block";

  if (question.questionType === "antonym") {
    questionTypeLabel.innerText = "🔄 Select the ANTONYM of:";
    questionTypeLabel.style.backgroundColor = "rgba(255, 80, 80, 0.18)";
    questionTypeLabel.style.color = "#ff6b6b";
    questionTypeLabel.style.border = "1px solid #ff6b6b";
  } else {
    questionTypeLabel.innerText = "📖 Select the MEANING of:";
    questionTypeLabel.style.backgroundColor = "rgba(79, 195, 247, 0.15)";
    questionTypeLabel.style.color = "#4fc3f7";
    questionTypeLabel.style.border = "1px solid #4fc3f7";
  }

  container.appendChild(questionTypeLabel);

  // Question word title
  const title = document.createElement("h3");
  title.innerText = question.word;

  if (examMode) {
    title.classList.add("exam-word");
  } else {
    title.classList.add("practice-word");
  }

  container.appendChild(title);

  // Phonetics badge
  if (question.phonetics) {
    const phonDiv = document.createElement("div");
    phonDiv.className = "phonetics-badge";
    phonDiv.innerText = question.phonetics;
    container.appendChild(phonDiv);
  }

  // Timer (exam only)
  if (examMode) {
    const timerDisplay = document.createElement("div");
    timerDisplay.className = "timer";
    container.appendChild(timerDisplay);
    startTimer(timerDisplay);
  }

  // Generate options
  const options = generateOptions(question);

  options.forEach(optionText => {
    const label = document.createElement("label");
    label.className = "option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = optionText;

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(optionText));

    container.appendChild(label);
  });

  const submitBtn = document.createElement("button");
  submitBtn.innerText = "Submit";
  submitBtn.className = "submit-btn";
  submitBtn.onclick = checkAnswer;
  container.appendChild(submitBtn);

}


function generateOptions(question) {

  const maxCorrectAllowed = 3;

  // ===== ANTONYM QUESTION =====
  if (question.questionType === "antonym") {

    const antonyms = question.antonyms || [];
    const shuffledAntonyms = shuffleArray(antonyms);

    const possibleMax = Math.min(maxCorrectAllowed, shuffledAntonyms.length);

    // Dynamic difficulty
    const accuracy = calculateAccuracy(question);
    let numberOfCorrect;
    const rand = Math.random();

    if (accuracy < 50) {
      numberOfCorrect = rand < 0.85 ? 1 : 2;
    } else if (accuracy < 80) {
      if (rand < 0.6) numberOfCorrect = 1;
      else if (rand < 0.9) numberOfCorrect = 2;
      else numberOfCorrect = 3;
    } else {
      if (rand < 0.3) numberOfCorrect = 1;
      else if (rand < 0.7) numberOfCorrect = 2;
      else numberOfCorrect = 3;
    }

    numberOfCorrect = Math.min(numberOfCorrect, possibleMax);
    if (numberOfCorrect < 1) numberOfCorrect = 1;

    const correctToUse = shuffledAntonyms.slice(0, numberOfCorrect);

    // ===== DISTRACTOR POOL: other words' meanings + antonyms (BOTH used as traps) =====
    const currentAntonymsLower = antonyms.map(a => a.toLowerCase());

    let incorrectPool = [];

    allWordsGlobal.forEach(w => {
      if (w.word === question.word) return;

      // Add meanings of other words as traps
      w.meanings.forEach(m => {
        if (!currentAntonymsLower.includes(m.toLowerCase())) {
          incorrectPool.push(m);
        }
      });

      // Add antonyms of other words as traps
      (w.antonyms || []).forEach(a => {
        if (!currentAntonymsLower.includes(a.toLowerCase())) {
          incorrectPool.push(a);
        }
      });
    });

    incorrectPool = [...new Set(incorrectPool)];

    const shuffledIncorrect = shuffleArray(incorrectPool);
    const neededIncorrect = 5 - correctToUse.length;
    const selectedIncorrect = shuffledIncorrect.slice(0, neededIncorrect);

    const finalOptions = shuffleArray([...correctToUse, ...selectedIncorrect]);

    question.currentCorrectAnswers = correctToUse;

    return finalOptions;
  }

  // ===== MEANING QUESTION (original logic) =====
  const shuffledCorrect = shuffleArray(question.meanings);
  const possibleMax = Math.min(maxCorrectAllowed, shuffledCorrect.length);

  const accuracy = calculateAccuracy(question);
  let numberOfCorrect;
  const rand = Math.random();

  if (accuracy < 50) {
    numberOfCorrect = rand < 0.85 ? 1 : 2;
  } else if (accuracy < 80) {
    if (rand < 0.6) numberOfCorrect = 1;
    else if (rand < 0.9) numberOfCorrect = 2;
    else numberOfCorrect = 3;
  } else {
    if (rand < 0.3) numberOfCorrect = 1;
    else if (rand < 0.7) numberOfCorrect = 2;
    else numberOfCorrect = 3;
  }

  numberOfCorrect = Math.min(numberOfCorrect, possibleMax);

  const correctToUse = shuffledCorrect.slice(0, numberOfCorrect);

  // Incorrect pool: meanings from other words only (exclude current word's meanings)
  const currentWordMeaningsLower = question.meanings.map(m => m.toLowerCase());

  const otherWords = allWordsGlobal.filter(w => w.word !== question.word);

  let incorrectPool = [];

  otherWords.forEach(w => {
    w.meanings.forEach(m => {
      if (!currentWordMeaningsLower.includes(m.toLowerCase())) {
        incorrectPool.push(m);
      }
    });
  });

  incorrectPool = [...new Set(incorrectPool)];

  const shuffledIncorrect = shuffleArray(incorrectPool);
  const neededIncorrect = 5 - correctToUse.length;
  const selectedIncorrect = shuffledIncorrect.slice(0, neededIncorrect);

  const finalOptions = shuffleArray([...correctToUse, ...selectedIncorrect]);

  question.currentCorrectAnswers = correctToUse;

  return finalOptions;
}


function checkAnswer() {

  const container = document.getElementById("focusContent");

  const checkboxes = container.querySelectorAll("input[type='checkbox']");
  const selected = [];

  checkboxes.forEach(cb => {
    if (cb.checked) selected.push(cb.value);
  });

  const correctAnswers = currentQuestions[currentIndex].currentCorrectAnswers;
  const totalCorrect = correctAnswers.length;
  const currentWordId = currentQuestions[currentIndex].id;
  const isAntonymQuestion = currentQuestions[currentIndex].questionType === "antonym";

  let correctSelected = 0;
  let wrongSelected = 0;

  selected.forEach(option => {

    const optionLower = option.toLowerCase();
    let isCorrect = false;

    // Direct match with correct answers
    if (correctAnswers.map(ans => ans.toLowerCase()).includes(optionLower)) {
      isCorrect = true;
    }

    // For MEANING questions only: cross-check via shared meanings
    else if (!isAntonymQuestion) {
      const optionWordObj = allWordsGlobal.find(
        w => w.word.toLowerCase() === optionLower
      );

      if (optionWordObj) {
        const optionMeanings = optionWordObj.meanings.map(m => m.toLowerCase());
        const correctLower = correctAnswers.map(ans => ans.toLowerCase());
        const hasIntersection = optionMeanings.some(m => correctLower.includes(m));
        if (hasIntersection) {
          isCorrect = true;
        }
      }
    }

    if (isCorrect) {
      correctSelected++;
    } else {
      wrongSelected++;
    }

  });


  let questionScore = 0;

  if (selected.length === 0) {
    questionScore = 0;
  } else if (wrongSelected > 0) {
    questionScore = examMode ? -0.25 : 0;
  } else {
    questionScore = correctSelected / totalCorrect;
  }

  score += questionScore;

  updateWordStats(currentWordId, questionScore);

  const fullyCorrect = (wrongSelected === 0 && correctSelected === totalCorrect);

  sessionResults.push({
    word: currentQuestions[currentIndex].word,
    questionType: currentQuestions[currentIndex].questionType,
    correctAnswers: correctAnswers,
    selectedAnswers: selected,
    isCorrect: fullyCorrect,
  });


  // PRACTICE MODE VISUAL FEEDBACK
  if (!examMode) {

    checkboxes.forEach(cb => {
      const label = cb.parentElement;

      if (correctAnswers.includes(cb.value)) {
        label.style.backgroundColor = "#c8e6c9";
      }

      if (cb.checked && !correctAnswers.includes(cb.value)) {
        label.style.backgroundColor = "#ffcdd2";
      }
    });

    const infoBar = container.firstChild;
    infoBar.innerText =
      `Question ${currentIndex + 1} / ${currentQuestions.length} | Score: ${score.toFixed(2)}`;

    const submitBtn = container.querySelector(".submit-btn");
    if (submitBtn) submitBtn.disabled = true;

    setTimeout(() => {
      currentIndex++;
      renderQuestion();
    }, 1500);

  } else {
    currentIndex++;
    clearInterval(timerInterval);
    timerInterval = null;
    renderQuestion();
  }
}



function startTimer(displayElement) {

  clearInterval(timerInterval);
  timerInterval = null;

  timeLeft = parseInt(document.getElementById("examTimerInput").value);

  if (isNaN(timeLeft) || timeLeft <= 0) {
    timeLeft = 10;
  }

  displayElement.innerText = "Time Left: " + timeLeft;

  timerInterval = setInterval(() => {

    timeLeft--;

    if (!document.body.contains(displayElement)) {
      clearInterval(timerInterval);
      timerInterval = null;
      return;
    }

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      displayElement.innerText = "Time Left: 0";
      currentIndex++;
      renderQuestion();
      return;
    }

    displayElement.innerText = "Time Left: " + timeLeft;

  }, 1000);
}


function showAnalytics(container) {

  getAllWords(function (words) {

    let totalAttempts = 0;
    let totalCorrect = 0;

    words.forEach(word => {
      totalAttempts += word.totalAttempts || 0;
      totalCorrect += word.correctCount || 0;
    });

    const accuracy = totalAttempts > 0
      ? ((totalCorrect / totalAttempts) * 100).toFixed(2)
      : 0;

    const weakest = [...words]
      .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0))
      .slice(0, 10);

    const strongest = [...words]
      .sort((a, b) => (b.correctCount || 0) - (a.correctCount || 0))
      .slice(0, 5);

    const analyticsDiv = document.createElement("div");
    analyticsDiv.style.marginTop = "20px";
    analyticsDiv.style.padding = "15px";
    analyticsDiv.style.borderTop = "2px solid #ccc";

    analyticsDiv.innerHTML = `
      <h3>📊 Performance Analytics</h3>
      <p><strong>Overall Accuracy:</strong> ${accuracy}%</p>

      <h4>⚠ Weakest Words</h4>
      <ul>
        ${weakest.map(w =>
          `<li>${w.word} (Wrong: ${w.wrongCount || 0})</li>`
        ).join("")}
      </ul>

      <h4>🔥 Strongest Words</h4>
      <ul>
        ${strongest.map(w =>
          `<li>${w.word} (Correct: ${w.correctCount || 0})</li>`
        ).join("")}
      </ul>
    `;

    container.appendChild(analyticsDiv);
  });
}

function calculateAccuracy(word) {
  const total = word.totalAttempts || 0;
  if (total === 0) return 0;
  return ((word.correctCount || 0) / total) * 100;
}


function loadSessionAnalytics() {

  const container = document.getElementById("analyticsContainer");
  container.innerHTML = "";

  // ===== TOTAL WORD COUNT =====
  const wordTransaction = db.transaction("words", "readonly");
  const wordStore = wordTransaction.objectStore("words");
  const wordCountRequest = wordStore.count();

  wordCountRequest.onsuccess = function () {

    const totalWords = wordCountRequest.result;

    const countCard = document.createElement("div");
    countCard.className = "analytics-card";
    countCard.style.borderTop = "4px solid #4caf50";

    countCard.innerHTML = `
      <h3>📚 Database Overview</h3>
      <div class="analytics-row">
        <span>Total Main Words</span>
        <span>${totalWords}</span>
      </div>
    `;

    container.appendChild(countCard);
  };

  // ===== LOAD SESSION DATA =====
  const transaction = db.transaction("sessions", "readonly");
  const store = transaction.objectStore("sessions");
  const request = store.getAll();

  request.onsuccess = function () {

    const sessions = request.result;
    const passageSessions = sessions.filter(s => s.type === "passage");
    if (!sessions || sessions.length === 0) {
      const noSession = document.createElement("p");
      noSession.innerText = "No sessions yet.";
      noSession.style.marginTop = "20px";
      container.appendChild(noSession);
    }

    const practiceSessions = sessions.filter(s => s.mode === "practice");
    const examSessions = sessions.filter(s => s.mode === "exam");

    function createCard(title, sessionList, color) {

      if (sessionList.length === 0) {
        return `
          <div class="analytics-card" style="border-top: 4px solid ${color}">
            <h3>${title}</h3>
            <p>No sessions yet.</p>
          </div>
        `;
      }

      const totalSessions = sessionList.length;

      const avgAccuracy = (
        sessionList.reduce((sum, s) => sum + parseFloat(s.accuracy || 0), 0) /
        totalSessions
      ).toFixed(2);

      const bestScore = Math.max(...sessionList.map(s => s.score || 0));

      const avgTime = (
        sessionList.reduce((sum, s) => sum + parseFloat(s.avgTimePerQuestion || 0), 0) /
        totalSessions
      ).toFixed(2);

      return `
        <div class="analytics-card" style="border-top: 4px solid ${color}">
          <h3>${title}</h3>
          <div class="analytics-row"><span>Total Sessions</span><span>${totalSessions}</span></div>
          <div class="analytics-row"><span>Average Accuracy</span><span>${avgAccuracy}%</span></div>
          <div class="analytics-row"><span>Best Score</span><span>${bestScore}</span></div>
          <div class="analytics-row"><span>Avg Time / Question</span><span>${avgTime} sec</span></div>
        </div>
      `;
    }

    const analyticsGrid = document.createElement("div");
    analyticsGrid.className = "analytics-grid";

    analyticsGrid.innerHTML = `
      ${createCard("📘 Practice Performance", practiceSessions, "#00c8ff")}
      ${createCard("📕 Exam Performance", examSessions, "#ff1a1a")}
    `;

    container.appendChild(analyticsGrid);
    // ===== PASSAGE ANALYTICS =====
const passageAccuracy =
  passageSessions.length > 0
    ? (passageSessions.reduce((sum, s) => sum + s.accuracy, 0) / passageSessions.length).toFixed(1)
    : 0;

const passageCard = document.createElement("div");
passageCard.className = "analytics-card";
passageCard.style.borderTop = "4px solid #ff9800";

passageCard.innerHTML = passageSessions.length === 0
  ? `<h3>📄 Passage Performance</h3><p>No attempts yet.</p>`
  : `
    <h3>📄 Passage Performance</h3>
    <div class="analytics-row">
      <span>Total Attempts</span>
      <span>${passageSessions.length}</span>
    </div>
    <div class="analytics-row">
      <span>Average Accuracy</span>
      <span>${passageAccuracy}%</span>
    </div>
  `;

container.appendChild(passageCard);
    // ===== LAST 7 DAYS UPLOAD CHART =====

    const chartContainer = document.getElementById("uploadChartContainer");
    chartContainer.innerHTML = "<h3>📊 Words Uploaded (Last 7 Days)</h3>";

    const wordTx = db.transaction("words", "readonly");
    const wordStore = wordTx.objectStore("words");
    const wordReq = wordStore.getAll();

    wordReq.onsuccess = function () {

      const words = wordReq.result;
      const today = new Date();

      const last7Days = [];

      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(today.getDate() - i);

        const key = date.toISOString().split("T")[0];

        const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
        const dayMonth = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });

        last7Days.push({ date: key, label: `${weekday}<br>${dayMonth}`, count: 0 });
      }

      words.forEach(word => {
        const d = new Date(word.createdAt);

const created =
  d.getFullYear() + "-" +
  String(d.getMonth() + 1).padStart(2, "0") + "-" +
  String(d.getDate()).padStart(2, "0");
        const dayObj = last7Days.find(d => d.date === created);
        if (dayObj) dayObj.count++;
      });

      const maxCount = Math.max(...last7Days.map(d => d.count), 1);

      const chartHTML = last7Days.map(day => {
        const heightPercent = (day.count / maxCount) * 100;
        return `
          <div class="upload-bar-wrapper">
            <div class="upload-bar" style="height:${heightPercent}%"></div>
            <span class="upload-count">${day.count}</span>
            <span class="upload-label">${day.label}</span>
          </div>
        `;
      }).join("");

      chartContainer.innerHTML += `
        <div class="upload-chart">
          ${chartHTML}
        </div>
      `;
    };

  };
}

function loadBookMode() {

  const container = document.getElementById("bookContainer");

  if (!container) {
    console.error("bookContainer not found in HTML");
    return;
  }
  container.innerHTML = "";

  getAllWords(function (words) {

    if (!words || words.length === 0) {
      container.innerHTML = "<p>No words available.</p>";
      return;
    }

    words.forEach(word => {

      const wordCard = document.createElement("div");
      wordCard.className = "word-card";
      wordCard.style.position = "relative";

      // ✏️ NOTE BUTTON
      const noteBtn = document.createElement("button");
      noteBtn.innerText = "✏️";
      noteBtn.className = "note-btn";
      noteBtn.onclick = function () { editNote(word.id); };
      wordCard.appendChild(noteBtn);

      // WORD TITLE
      const title = document.createElement("h3");
      title.innerText = word.word;
      wordCard.appendChild(title);

      // PHONETICS
      if (word.phonetics) {
        const phon = document.createElement("div");
        phon.innerText = word.phonetics;
        phon.className = "phonetics-badge";
        wordCard.appendChild(phon);
      }

      // MEANINGS
      const meaningDiv = document.createElement("div");
      meaningDiv.innerText = (word.meanings || []).join(", ");
      wordCard.appendChild(meaningDiv);

      // 📝 NOTE DISPLAY
      if (word.note) {
        const noteDiv = document.createElement("div");
        noteDiv.className = "note-display";
        noteDiv.innerText = "📝 " + word.note;
        noteDiv.style.whiteSpace = "pre-wrap";
        wordCard.appendChild(noteDiv);
      }

      container.appendChild(wordCard);

    });

  });
}

function updateLastAsked(wordId) {

  const transaction = db.transaction("words", "readwrite");
  const store = transaction.objectStore("words");

  const request = store.get(wordId);

  request.onsuccess = function () {
    const word = request.result;
    if (!word) return;
    word.lastAsked = Date.now();
    store.put(word);
  };
}


const fileInput = document.getElementById("excelFile");
const customFileBtn = document.getElementById("customFileBtn");
const fileNameDisplay = document.getElementById("fileName");

customFileBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    fileNameDisplay.textContent = fileInput.files[0].name;
  } else {
    fileNameDisplay.textContent = "No file selected";
  }
});

/***********************
  FOCUS MODE FUNCTIONS
************************/

function enterFocusMode() {
  const focus = document.getElementById("focusMode");
  focus.classList.add("active");
  document.body.classList.add("locked");
}


function endQuiz() {

  clearInterval(timerInterval);
  timerInterval = null;
  quizEndTime = Date.now();

  const container = document.getElementById("focusContent");
  container.innerHTML = "";

  const totalQuestions = sessionResults.length;
  const correctCount = sessionResults.filter(r => r.isCorrect).length;
  const wrongCount = totalQuestions - correctCount;

  const accuracy = totalQuestions > 0
    ? ((correctCount / totalQuestions) * 100).toFixed(2)
    : 0;

  const totalTimeMs = quizEndTime - quizStartTime;
  const totalTimeSec = Math.floor(totalTimeMs / 1000);
  const avgTimePerQuestion = totalQuestions > 0
    ? (totalTimeSec / totalQuestions).toFixed(2)
    : 0;

  const finalScore = score.toFixed(2);
  const maxScore = totalQuestions;

  const summary = document.createElement("div");
  summary.className = "exam-summary";

  summary.innerHTML = `
    <div class="result-card">
      <h2>${examMode ? "Exam Result" : "Practice Summary"}</h2>

      ${examMode ? `
        <div class="score-box">
          ${finalScore} / ${maxScore}
        </div>
      ` : ""}

      <div class="result-grid">
        <div><span>Total Questions</span><strong>${totalQuestions}</strong></div>
        <div><span>Correct</span><strong>${correctCount}</strong></div>
        <div><span>Wrong</span><strong>${wrongCount}</strong></div>
        <div><span>Accuracy</span><strong>${accuracy}%</strong></div>
        <div><span>Total Time</span><strong>${totalTimeSec} sec</strong></div>
        <div><span>Avg Time / Question</span><strong>${avgTimePerQuestion} sec</strong></div>
      </div>
    </div>

    <hr style="margin:30px 0;">
    <h3>Words Done Wrong</h3>
  `;

  container.appendChild(summary);

  const wrongWords = sessionResults.filter(r => !r.isCorrect);

  if (wrongWords.length === 0) {
    const perfect = document.createElement("p");
    perfect.innerHTML = "🔥 <strong>Perfect Session!</strong> No wrong answers.";
    container.appendChild(perfect);

  } else {

    wrongWords.forEach(item => {
      const div = document.createElement("div");
      div.className = "wrong-word-card";

      // Show question type in the review card too
      const typeTag = item.questionType === "antonym"
        ? `<span style="color:#ff6b6b;font-size:0.85em;">🔄 Antonym Q</span>`
        : `<span style="color:#4fc3f7;font-size:0.85em;">📖 Meaning Q</span>`;

      div.innerHTML = `
        <strong class="wrong-word-title">${item.word}</strong> ${typeTag}<br>
        <span class="wrong-label">Your Answer:</span>
          ${item.selectedAnswers.length > 0 ? item.selectedAnswers.join(", ") : "None"}<br>
        <span class="correct-label">Correct Answer:</span>
          ${item.correctAnswers.join(", ")}
      `;

      container.appendChild(div);
    });
  }

  const exitBtn = document.createElement("button");
  exitBtn.innerText = "Return to Dashboard";
  exitBtn.style.marginTop = "30px";
  exitBtn.onclick = exitFocusMode;
  container.appendChild(exitBtn);

  addSessionToDB({
    mode: examMode ? "exam" : "practice",
    score: score,
    totalQuestions: totalQuestions,
    correct: correctCount,
    wrong: wrongCount,
    accuracy: accuracy,
    totalTimeSec: totalTimeSec,
    avgTimePerQuestion: avgTimePerQuestion,
    date: new Date(),
    timestamp: Date.now()
  }, function () {
    loadSessionAnalytics();
  });

}

function exitFocusMode() {
  clearInterval(timerInterval);
  timerInterval = null;

  const focus = document.getElementById("focusMode");
  focus.classList.remove("active");
  document.body.classList.remove("locked");

  document.getElementById("focusContent").innerHTML = "";
}


setTimeout(() => {
  loadSessionAnalytics();
}, 500);

function masterDeleteAllData() {

  const password = prompt("Enter Master Password:");

  if (password !== "552554") {
    alert("Incorrect Password!");
    return;
  }

  if (!confirm("This will permanently delete ALL data. Are you absolutely sure?")) {
    return;
  }

  const transaction = db.transaction(["words", "sessions", "passages"], "readwrite");

  const wordsStore = transaction.objectStore("words");
  const sessionsStore = transaction.objectStore("sessions");
  const passagesStore = transaction.objectStore("passages");

  wordsStore.clear();
  sessionsStore.clear();
  passagesStore.clear();

  transaction.oncomplete = function () {
    alert("All data deleted successfully.");
    loadSessionAnalytics();
  };

  transaction.onerror = function () {
    alert("Error deleting data.");
  };
}

document.getElementById("masterDeleteBtn")
  .addEventListener("click", masterDeleteAllData);

// ===== EXPORT: open choice modal =====
function openExportModal() {
  document.getElementById("exportModal").style.display = "flex";
}
function closeExportModal() {
  document.getElementById("exportModal").style.display = "none";
}

// ===== EXPORT OPTION A: Full backup (words + stats + sessions + passages) =====
function doExportFull() {
  closeExportModal();
  const tx = db.transaction(["words", "sessions", "passages"], "readonly");
  const words    = [];
  const sessions = [];
  const passages = [];
  let pending = 3;

  function tryFinish() {
    pending--;
    if (pending > 0) return;
    const backup = {
      _type: "vocabpractice_full_backup",
      _date: new Date().toISOString(),
      words, sessions, passages
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), {
      href: url,
      download: "vocab_full_backup_" + new Date().toISOString().split("T")[0] + ".json"
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  tx.objectStore("words").getAll().onsuccess    = e => { words.push(...e.target.result);    tryFinish(); };
  tx.objectStore("sessions").getAll().onsuccess = e => { sessions.push(...e.target.result); tryFinish(); };
  tx.objectStore("passages").getAll().onsuccess = e => { passages.push(...e.target.result); tryFinish(); };
}

// ===== EXPORT OPTION B: Words only (no stats) =====
function doExportWordsOnly() {
  closeExportModal();
  getAllWords(function (words) {
    if (!words || words.length === 0) { alert("No words to export."); return; }
    const rows = words.map(w => ({
      Word:      w.word,
      Meaning:   (w.meanings  || []).join(", "),
      Antonyms:  (w.antonyms  || []).join(", "),
      Phonetics: w.phonetics  || "",
      Note:      w.note       || ""
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Vocabulary");
    XLSX.writeFile(wb, "vocab_words_" + new Date().toISOString().split("T")[0] + ".xlsx");
  });
}

document.getElementById("exportBtn").addEventListener("click", openExportModal);

// ===== IMPORT FULL BACKUP (merge, respects duplicate logic) =====
document.getElementById("importBackupInput").addEventListener("change", function () {
  const file = this.files[0];
  if (!file) return;
  this.value = "";
  const reader = new FileReader();
  reader.onload = function (e) {
    let backup;
    try { backup = JSON.parse(e.target.result); } catch { alert("❌ Invalid JSON file."); return; }
    if (backup._type !== "vocabpractice_full_backup") { alert("❌ Not a valid full backup file."); return; }
    if (!confirm("Import backup?\nWords will be merged (duplicates skipped). Sessions & passages will be added.")) return;

    // --- Merge words (same duplicate logic as upload: unique word index) ---
    const tx = db.transaction("words", "readwrite");
    const store = tx.objectStore("words");
    let imported = 0, skipped = 0;
    const incoming = backup.words || [];

    function importNextWord(i) {
      if (i >= incoming.length) {
        // After words done, import sessions and passages
        importSessions(backup.sessions || []);
        importPassages(backup.passages || []);
        document.getElementById("uploadStatus").innerText =
          "✅ Import done — " + imported + " words merged, " + skipped + " duplicates skipped.";
        loadSessionAnalytics();
        return;
      }
      const w = incoming[i];
      if (!w.word) { skipped++; importNextWord(i + 1); return; }
      const idx = store.index("word");
      const req = idx.get(w.word.trim().toLowerCase());
      req.onsuccess = function () {
        const existing = req.result;
        if (existing) {
          // Merge meanings and antonyms, keep stats (existing wins)
          existing.meanings  = [...new Set([...(existing.meanings||[]), ...(w.meanings||[])])];
          existing.antonyms  = [...new Set([...(existing.antonyms||[]), ...(w.antonyms||[])])];
          if (!existing.phonetics && w.phonetics) existing.phonetics = w.phonetics;
          if (!existing.note      && w.note)      existing.note      = w.note;
          store.put(existing);
          skipped++;
        } else {
          // Strip id so IndexedDB auto-assigns a new one (avoids key conflicts)
          const copy = Object.assign({}, w);
          delete copy.id;
          store.add(copy);
          imported++;
        }
        importNextWord(i + 1);
      };
    }
    importNextWord(0);

    function importSessions(sessions) {
      if (!sessions.length) return;
      const stx = db.transaction("sessions", "readwrite");
      const ss  = stx.objectStore("sessions");
      sessions.forEach(s => { const c = Object.assign({}, s); delete c.id; ss.add(c); });
    }
    function importPassages(passages) {
      if (!passages.length) return;
      const ptx = db.transaction("passages", "readwrite");
      const ps  = ptx.objectStore("passages");
      passages.forEach(p => { const c = Object.assign({}, p); delete c.id; ps.add(c); });
    }

    showSection("upload");
  };
  reader.readAsText(file);
});

// ===== THEME SYSTEM =====

const themeBtn = document.getElementById("themeToggleBtn");

const savedTheme = localStorage.getItem("theme");

if (savedTheme === "light") {
  document.body.classList.add("light-mode");
  themeBtn.innerText = "☀ Light Mode";
} else {
  themeBtn.innerText = "🌙 Dark Mode";
}

themeBtn.addEventListener("click", function () {

  document.body.classList.toggle("light-mode");

  if (document.body.classList.contains("light-mode")) {
    localStorage.setItem("theme", "light");
    themeBtn.innerText = "☀ Light Mode";
  } else {
    localStorage.setItem("theme", "dark");
    themeBtn.innerText = "🌙 Dark Mode";
  }

});

function updateWordStats(wordId, performanceScore) {

  const transaction = db.transaction("words", "readwrite");
  const store = transaction.objectStore("words");
  const request = store.get(wordId);

  request.onsuccess = function () {

    const word = request.result;
    if (!word) return;

    word.totalAttempts = (word.totalAttempts || 0) + 1;

    const now = Date.now();

    if (performanceScore <= 0) {
      word.wrongCount = (word.wrongCount || 0) + 1;
      word.reviewInterval = 1;
    } else if (performanceScore < 1) {
      word.correctCount = (word.correctCount || 0) + 1;
      word.reviewInterval = 2;
    } else {
      word.correctCount = (word.correctCount || 0) + 1;
      word.reviewInterval = Math.min((word.reviewInterval || 1) * 2, 14);
    }

    word.nextReviewDate = now + (word.reviewInterval * 24 * 60 * 60 * 1000);

    store.put(word);
  };
}

function editNote(wordId) {

  const transaction = db.transaction("words", "readwrite");
  const store = transaction.objectStore("words");

  const request = store.get(wordId);

  request.onsuccess = function () {

    const word = request.result;
    if (!word) return;

    const newNote = prompt("✏️ Add / Edit Note:", word.note || "");

    if (newNote !== null) {
      word.note = newNote.trim();
      store.put(word);
      alert("Note saved!");
      loadBookMode();
    }

  };
}

// ═══════════════════════════════════════════════════════
// GITHUB FETCH  (Practice Engine)
// ═══════════════════════════════════════════════════════
function convertToRawUrl(url) {
  url = url.trim();
  if (url.includes("raw.githubusercontent.com")) return url;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/);
  if (m) return "https://raw.githubusercontent.com/" + m[1] + "/" + m[2] + "/" + m[3];
  return url;
}

function vpeSetStatus(msg) {
  document.getElementById("uploadStatus").innerText = msg;
}

async function vpeFetchAndProcess(rawUrl) {
  const url = convertToRawUrl(rawUrl);
  vpeSetStatus("⏳ Fetching from GitHub…");
  let arrayBuf;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    arrayBuf = await res.arrayBuffer();
  } catch (err) {
    vpeSetStatus("❌ Fetch failed: " + err.message + ". Make sure the repo is public and URL points to a raw .xlsx file.");
    return;
  }

  // Parse Excel — same logic as the file upload handler
  let jsonData;
  try {
    const data = new Uint8Array(arrayBuf);
    const wb   = XLSX.read(data, { type: "array" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    jsonData   = XLSX.utils.sheet_to_json(ws);
  } catch (err) {
    vpeSetStatus("❌ Could not parse Excel: " + err.message);
    return;
  }

  if (!jsonData.length) { vpeSetStatus("❌ Excel file is empty or invalid format."); return; }

  // Need a date — use today if none selected
  const dateInput = document.getElementById("uploadDateInput").value;
  let selectedDate;
  if (dateInput) {
    const [y, mo, d] = dateInput.split("-").map(Number);
    selectedDate = new Date(y, mo - 1, d);
  } else {
    selectedDate = new Date();
    selectedDate.setHours(0, 0, 0, 0);
  }

  const firstRow = jsonData[0];

  // Passage file
  if (firstRow.PassageTitle && firstRow.Question) {
    processPassages(jsonData, selectedDate);
    vpeSetStatus("✅ Passage data fetched from GitHub and saved!");
    loadSessionAnalytics();
    return;
  }

  // Vocab file
  if (firstRow.Word && firstRow.Meaning) {
    const batchId = new Date().toISOString();
    let addedCount = 0;
    let pending    = jsonData.length;
    const transaction = db.transaction("words", "readwrite");
    const store       = transaction.objectStore("words");

    jsonData.forEach(row => {
      const mainWord = row.Word ? row.Word.trim().toLowerCase() : "";
      if (!mainWord) { pending--; if (pending === 0) vpeSetStatus("✅ Done (0 words)"); return; }

      const meanings = row.Meaning
        ? row.Meaning.split(",").map(m => m.trim().toLowerCase()).filter(Boolean) : [];
      const antonyms = row.Antonyms
        ? row.Antonyms.split(",").map(a => a.trim().toLowerCase()).filter(Boolean) : [];

      const wordObject = {
        word: mainWord, meanings, antonyms,
        phonetics: row.Phonetics || "", note: row.Note || "",
        wrongCount: 0, correctCount: 0, totalAttempts: 0,
        lastAsked: null, reviewInterval: 1,
        nextReviewDate: selectedDate.getTime(),
        batchId, createdAt: selectedDate
      };

      const req = store.index("word").get(mainWord);
      req.onsuccess = function () {
        const existing = req.result;
        if (existing) {
          existing.meanings = [...new Set([...(existing.meanings||[]), ...meanings])];
          existing.antonyms = [...new Set([...(existing.antonyms||[]), ...antonyms])];
          if (!existing.phonetics && row.Phonetics) existing.phonetics = row.Phonetics;
          if (!existing.note      && row.Note)      existing.note      = row.Note;
          store.put(existing);
        } else {
          store.add(wordObject);
          addedCount++;
        }
        pending--;
        if (pending === 0) {
          vpeSetStatus("✅ Fetched from GitHub! " + addedCount + " new words added.");
          loadSessionAnalytics();
        }
      };
    });
    return;
  }

  vpeSetStatus("❌ Invalid Excel format! Check column names (Word, Meaning required).");
}

document.getElementById("githubFetchBtn").addEventListener("click", function () {
  const url = document.getElementById("githubUrlInput").value.trim();
  if (!url) { vpeSetStatus("⚠️ Paste a GitHub URL first."); return; }
  if (!db)  { vpeSetStatus("⚠️ Database not ready yet."); return; }
  vpeFetchAndProcess(url);
});

// ═══════════════════════════════════════════════════════
// QR SHARE ENGINE  (Practice Engine)
// ═══════════════════════════════════════════════════════
let _vpeQrStream   = null;
let _vpeQrInterval = null;
let _vpeQrFound    = false;

function openVQR(mode) {
  const modal     = document.getElementById("qrModal");
  const showPanel = document.getElementById("vqrShowPanel");
  const scanPanel = document.getElementById("vqrScanPanel");
  showPanel.style.display = mode === "show" ? "" : "none";
  scanPanel.style.display = mode === "scan" ? "" : "none";
  modal.style.display = "flex";

  if (mode === "show") {
    const url = document.getElementById("githubUrlInput").value.trim();
    if (!url) { closeVQR(); vpeSetStatus("⚠️ Paste a GitHub URL first, then press Show QR."); return; }
    const box = document.getElementById("vqrCodeBox");
    box.innerHTML = "";
    try {
      /* global qrcode */
      const qr = qrcode(0, "M");
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createTableTag(5, 0);
      const t = box.querySelector("table");
      if (t) { t.style.border = "none"; t.style.borderCollapse = "collapse"; }
    } catch(e) {
      box.innerHTML = "<div style='color:red;font-size:12px;padding:10px'>⚠️ URL too long for QR</div>";
    }
    document.getElementById("vqrUrlPreview").textContent = url;
  }

  if (mode === "scan") {
    _vpeQrFound = false;
    vpeQrSetStatus("📷 Starting camera…", "");
    vpeStartCamera();
  }
}

window.closeVQR = function () {
  vpeStopCamera();
  document.getElementById("qrModal").style.display = "none";
  document.getElementById("vqrCodeBox").innerHTML = "";
};

document.getElementById("showQrBtn").addEventListener("click", () => openVQR("show"));
document.getElementById("scanQrBtn").addEventListener("click", () => openVQR("scan"));
document.getElementById("qrModal").addEventListener("click", function (e) {
  if (e.target === this) closeVQR();
});

function vpeQrSetStatus(msg, cls) {
  const el = document.getElementById("vqrStatus");
  if (!el) return;
  el.textContent  = msg;
  el.className    = "vqr-status" + (cls ? " " + cls : "");
}

function vpeStartCamera() {
  /* global jsQR */
  if (typeof jsQR === "undefined") { vpeQrSetStatus("⚠️ jsQR not loaded — refresh page.", "err"); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    vpeQrSetStatus("⚠️ Camera not supported on this browser.", "err"); return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
    .then(function (stream) {
      _vpeQrStream = stream;
      const video = document.getElementById("vqrVideo");
      video.srcObject = stream;
      video.onloadedmetadata = function () {
        video.play().then(function () {
          vpeQrSetStatus("📷 Scanning… point at the QR code", "");
          if (_vpeQrInterval) clearInterval(_vpeQrInterval);
          _vpeQrInterval = setInterval(vpeScanFrame, 100);
        }).catch(e => vpeQrSetStatus("⚠️ Video error: " + e.message, "err"));
      };
    })
    .catch(function (err) {
      const msgs = { NotAllowedError: "Camera permission denied.", NotFoundError: "No camera found.", NotReadableError: "Camera in use by another app." };
      vpeQrSetStatus("⚠️ " + (msgs[err.name] || err.message), "err");
    });
}

function vpeScanFrame() {
  if (_vpeQrFound) return;
  const modal = document.getElementById("qrModal");
  if (!modal || modal.style.display === "none") { vpeStopCamera(); return; }
  const video = document.getElementById("vqrVideo");
  if (!video || video.readyState < 2) return;
  const W = video.videoWidth, H = video.videoHeight;
  if (!W || !H) return;
  const canvas = document.getElementById("vqrCanvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, W, H);
  const imgData = ctx.getImageData(0, 0, W, H);
  const code = jsQR(imgData.data, W, H, { inversionAttempts: "attemptBoth" });
  if (code && code.data) {
    _vpeQrFound = true;
    vpeQrSetStatus("✅ QR detected!", "ok");
    vpeStopCamera();
    setTimeout(() => vpeHandleScannedUrl(code.data), 300);
  }
}

function vpeStopCamera() {
  if (_vpeQrInterval) { clearInterval(_vpeQrInterval); _vpeQrInterval = null; }
  if (_vpeQrStream)   { _vpeQrStream.getTracks().forEach(t => t.stop()); _vpeQrStream = null; }
  const v = document.getElementById("vqrVideo");
  if (v) { v.onloadedmetadata = null; v.srcObject = null; }
}

function vpeHandleScannedUrl(scannedUrl) {
  const url = (scannedUrl || "").trim();
  if (!url.startsWith("http")) {
    _vpeQrFound = false;
    vpeQrSetStatus("⚠️ Not a valid URL. Try again.", "err");
    setTimeout(() => { vpeQrSetStatus("📷 Scanning…", ""); _vpeQrFound = false; vpeStartCamera(); }, 2000);
    return;
  }
  closeVQR();
  document.getElementById("githubUrlInput").value = url;
  if (!db) { vpeSetStatus("⚠️ Database not ready. Try Fetch manually."); return; }
  vpeFetchAndProcess(url);
}

// expose for modal onclick attributes
window.closeExportModal = closeExportModal;
window.openExportModal  = openExportModal;
window.doExportFull     = doExportFull;
window.doExportWordsOnly = doExportWordsOnly;

});
