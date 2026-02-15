
document.addEventListener("DOMContentLoaded", function () {



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
  document.getElementById("uploadBtn").disabled = true;

  const request = indexedDB.open("VocabDB", 1);

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

      wordsStore.createIndex("word", "word", { unique: false });
      wordsStore.createIndex("batchId", "batchId", { unique: false });
    }

    // SESSIONS STORE
    if (!db.objectStoreNames.contains("sessions")) {
      db.createObjectStore("sessions", {
        keyPath: "id",
        autoIncrement: true
      });
    }

    logDebug("Database structure created");
  };

  request.onsuccess = function () {

    db = request.result;
    logDebug("Database opened successfully");

    // Enable buttons now
    document.getElementById("startPractice").disabled = false;
    document.getElementById("startExam").disabled = false;
    document.getElementById("startWeakMode").disabled = false;
    document.getElementById("uploadBtn").disabled = false;

    // 🔥 Always refresh analytics once DB is ready
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

        const batchId = new Date().toISOString();

        let addedCount = 0;

        jsonData.forEach(row => {
          const wordObject = {
  word: row.Word ? row.Word.trim() : "",
  meanings: row.Meaning
    ? row.Meaning.split(",").map(m => m.trim())
    : [],
  wrongCount: 0,
  correctCount: 0,
  totalAttempts: 0,
  lastAsked: null,
  reviewInterval: 1,
  nextReviewDate: Date.now(),
  batchId: batchId,
  createdAt: new Date()
};


          if (wordObject.word !== "") {
            addWordToDB(wordObject);
            addedCount++;
          }
        });

        logDebug("Excel processed. Words added: " + addedCount);

        document.getElementById("uploadStatus").innerText =
          "Upload successful! Words saved to database.";
// Auto refresh analytics after upload
setTimeout(() => {
  loadSessionAnalytics();
}, 300);

        fileInput.value = "";

      } catch (error) {
        logDebug("Excel Processing Error: " + error.message);
      }
    };

    reader.readAsArrayBuffer(file);
  });

let allWordsGlobal = [];

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
  startWeakDrill(20); // 20 weak questions
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


function startQuiz(totalQuestions, isExam) {

  if (!db) {
    alert("Database not ready.");
    return;
  }

  getAllWords(function (words) {

    allWordsGlobal = words;

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

    const freshWords = words.filter(w => {
      return !w.lastAsked || (now - w.lastAsked) > oneDay;
    });

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

    currentQuestions = shuffleArray(selected);

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

    examMode = false; // Drill behaves like practice
    score = 0;
    currentIndex = 0;

    // Sort by wrongCount descending
    const sortedByWeakness = [...words]
      .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0));

    const weakestPool = sortedByWeakness.slice(0, 30);

    const shuffled = shuffleArray(weakestPool);

    currentQuestions = shuffled.slice(0, totalQuestions);

enterFocusMode();
renderQuestion();

  });
}

function renderQuestion() {

  if (currentIndex >= currentQuestions.length) {
    endQuiz();
    return;
  }

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
  infoBar.innerText =
    `Question ${currentIndex + 1} / ${currentQuestions.length}`;
} else {
  infoBar.innerText =
    `Question ${currentIndex + 1} / ${currentQuestions.length} | Score: ${score.toFixed(2)}`;
}

  container.appendChild(infoBar);

  // Question title
  const title = document.createElement("h3");
title.innerText = question.word;

if (examMode) {
  title.classList.add("exam-word");
} else {
  title.classList.add("practice-word");
}

container.appendChild(title);


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

  const shuffledCorrect = shuffleArray(question.meanings);

  const possibleMax = Math.min(maxCorrectAllowed, shuffledCorrect.length);

  // 🎯 Weighted Probability Logic
  // 🎯 Dynamic Difficulty Based on Performance

const accuracy = calculateAccuracy(question);

let numberOfCorrect;
const rand = Math.random();

if (accuracy < 50) {
  // Weak word → Easier
  if (rand < 0.85) numberOfCorrect = 1;
  else numberOfCorrect = 2;
}

else if (accuracy < 80) {
  // Medium word → Balanced
  if (rand < 0.6) numberOfCorrect = 1;
  else if (rand < 0.9) numberOfCorrect = 2;
  else numberOfCorrect = 3;
}

else {
  // Strong word → Harder
  if (rand < 0.3) numberOfCorrect = 1;
  else if (rand < 0.7) numberOfCorrect = 2;
  else numberOfCorrect = 3;
}


  numberOfCorrect = Math.min(numberOfCorrect, possibleMax);

  const correctToUse = shuffledCorrect.slice(0, numberOfCorrect);

  // Build incorrect pool
  const otherWords = allWordsGlobal.filter(
    w => w.word !== question.word
  );

  let incorrectPool = [];

  otherWords.forEach(w => {
    w.meanings.forEach(m => {
      incorrectPool.push(m);
    });
  });

  incorrectPool = [...new Set(incorrectPool)];

  const shuffledIncorrect = shuffleArray(incorrectPool);

  const totalOptions = 5;
  const neededIncorrect = totalOptions - correctToUse.length;

  const selectedIncorrect = shuffledIncorrect.slice(0, neededIncorrect);

  const finalOptions = shuffleArray([
    ...correctToUse,
    ...selectedIncorrect
  ]);

  // Store correct answers temporarily
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

  let correctSelected = 0;
  let wrongSelected = 0;

  selected.forEach(option => {
    if (correctAnswers.includes(option)) {
      correctSelected++;
    } else {
      wrongSelected++;
    }
  });

  let questionScore = 0;

  // 🚫 Nothing selected
  if (selected.length === 0) {
    questionScore = 0;
  }

  // ❌ Any wrong selected
  else if (wrongSelected > 0) {
    questionScore = examMode ? -0.25 : 0;
  }

  // ✅ Only correct selected
  else {
    questionScore = correctSelected / totalCorrect;
  }

  score += questionScore;

updateWordStats(currentWordId, questionScore);
// Store session result
sessionResults.push({
  word: currentQuestions[currentIndex].word,
  correctAnswers: correctAnswers,
  selectedAnswers: selected,
  isCorrect: questionScore > 0,
});


  // 🔵 PRACTICE MODE VISUAL FEEDBACK
  if (!examMode) {

    checkboxes.forEach(cb => {
      const label = cb.parentElement;

      // Correct answers → green
      if (correctAnswers.includes(cb.value)) {
        label.style.backgroundColor = "#c8e6c9";
      }

      // Wrong selected → red
      if (cb.checked && !correctAnswers.includes(cb.value)) {
        label.style.backgroundColor = "#ffcdd2";
      }
    });

    // Update score display
    if (!examMode) {
  const infoBar = container.firstChild;
  infoBar.innerText =
    `Question ${currentIndex + 1} / ${currentQuestions.length} | Score: ${score.toFixed(2)}`;
}


    // Disable submit
const submitBtn = container.querySelector(".submit-btn");
if (submitBtn) submitBtn.disabled = true;


    setTimeout(() => {
      currentIndex++;
      renderQuestion();
    }, 1500);

  } else {
    // 🔴 EXAM MODE → No color feedback
    currentIndex++;
    clearInterval(timerInterval);
    renderQuestion();
  }
}



function startTimer(displayElement) {

  // Stop any previous timer
  clearInterval(timerInterval);

  // Reset time for EACH question
  timeLeft = parseInt(document.getElementById("examTimerInput").value);

  // Safety check
  if (isNaN(timeLeft) || timeLeft <= 0) {
    timeLeft = 10; // default fallback
  }

  displayElement.innerText = "Time Left: " + timeLeft;

  timerInterval = setInterval(() => {

    timeLeft--;

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
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

    // Sort weakest words
    const weakest = [...words]
      .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0))
      .slice(0, 10);

    // Sort strongest words
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

    if (!sessions || sessions.length === 0) {
      const noSession = document.createElement("p");
      noSession.innerText = "No sessions yet.";
      noSession.style.marginTop = "20px";
      container.appendChild(noSession);
      return;
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
  };
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

        <div>
          <span>Total Questions</span>
          <strong>${totalQuestions}</strong>
        </div>

        <div>
          <span>Correct</span>
          <strong>${correctCount}</strong>
        </div>

        <div>
          <span>Wrong</span>
          <strong>${wrongCount}</strong>
        </div>

        <div>
          <span>Accuracy</span>
          <strong>${accuracy}%</strong>
        </div>

        <div>
          <span>Total Time</span>
          <strong>${totalTimeSec} sec</strong>
        </div>

        <div>
          <span>Avg Time / Question</span>
          <strong>${avgTimePerQuestion} sec</strong>
        </div>

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

      div.innerHTML = `
        <strong class="wrong-word-title">${item.word}</strong><br>
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

  const transaction = db.transaction(["words", "sessions"], "readwrite");

  const wordsStore = transaction.objectStore("words");
  const sessionsStore = transaction.objectStore("sessions");

  wordsStore.clear();
  sessionsStore.clear();

  transaction.oncomplete = function () {
    alert("All data deleted successfully.");

    // Refresh analytics after deletion
    loadSessionAnalytics();
  };

  transaction.onerror = function () {
    alert("Error deleting data.");
  };
}

document.getElementById("masterDeleteBtn")
  .addEventListener("click", masterDeleteAllData);
// ===== THEME SYSTEM =====

const themeBtn = document.getElementById("themeToggleBtn");

// Load saved theme
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
    }

    else if (performanceScore < 1) {
      word.correctCount = (word.correctCount || 0) + 1;
      word.reviewInterval = 2;
    }

    else {
      word.correctCount = (word.correctCount || 0) + 1;
      word.reviewInterval = Math.min((word.reviewInterval || 1) * 2, 14);
    }

    word.nextReviewDate = now + (word.reviewInterval * 24 * 60 * 60 * 1000);

    store.put(word);
  };
}







});



