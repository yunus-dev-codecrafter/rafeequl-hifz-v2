'use strict';

/**
 * Rafeequl Hifz (رفيق الحفظ) — Internationalization (i18n) Engine
 * Supported Languages:
 *   - 'ar' (العربية — Arabic, default, RTL)
 *   - 'en' (English, LTR)
 */

const SURAHS_DATA = [
  { id: 1,   name_ar: "الفاتحة",    name_en: "Al-Fatihah",      ayahs: 7 },
  { id: 2,   name_ar: "البقرة",     name_en: "Al-Baqarah",      ayahs: 286 },
  { id: 3,   name_ar: "آل عمران",   name_en: "Aal-Imran",       ayahs: 200 },
  { id: 4,   name_ar: "النساء",     name_en: "An-Nisa",         ayahs: 176 },
  { id: 5,   name_ar: "المائدة",    name_en: "Al-Maidah",       ayahs: 120 },
  { id: 6,   name_ar: "الأنعام",    name_en: "Al-Anam",         ayahs: 165 },
  { id: 7,   name_ar: "الأعراف",    name_en: "Al-Araf",         ayahs: 206 },
  { id: 8,   name_ar: "الأنفال",    name_en: "Al-Anfal",        ayahs: 75 },
  { id: 9,   name_ar: "التوبة",     name_en: "At-Tawbah",       ayahs: 129 },
  { id: 10,  name_ar: "يونس",       name_en: "Yunus",           ayahs: 109 },
  { id: 11,  name_ar: "هود",        name_en: "Hud",             ayahs: 123 },
  { id: 12,  name_ar: "يوسف",       name_en: "Yusuf",           ayahs: 111 },
  { id: 13,  name_ar: "الرعد",      name_en: "Ar-Rad",          ayahs: 43 },
  { id: 14,  name_ar: "إبراهيم",    name_en: "Ibrahim",         ayahs: 52 },
  { id: 15,  name_ar: "الحجر",      name_en: "Al-Hijr",         ayahs: 99 },
  { id: 16,  name_ar: "النحل",      name_en: "An-Nahl",         ayahs: 128 },
  { id: 17,  name_ar: "الإسراء",    name_en: "Al-Isra",         ayahs: 111 },
  { id: 18,  name_ar: "الكهف",      name_en: "Al-Kahf",         ayahs: 110 },
  { id: 19,  name_ar: "مريم",       name_en: "Maryam",          ayahs: 98 },
  { id: 20,  name_ar: "طه",         name_en: "Ta-Ha",           ayahs: 135 },
  { id: 21,  name_ar: "الأنبياء",   name_en: "Al-Anbiya",       ayahs: 112 },
  { id: 22,  name_ar: "الحج",       name_en: "Al-Hajj",         ayahs: 78 },
  { id: 23,  name_ar: "المؤمنون",   name_en: "Al-Muminun",      ayahs: 118 },
  { id: 24,  name_ar: "النور",      name_en: "An-Nur",          ayahs: 64 },
  { id: 25,  name_ar: "الفرقان",    name_en: "Al-Furqan",       ayahs: 77 },
  { id: 26,  name_ar: "الشعراء",    name_en: "Ash-Shuara",      ayahs: 227 },
  { id: 27,  name_ar: "النمل",      name_en: "An-Naml",         ayahs: 93 },
  { id: 28,  name_ar: "القصص",      name_en: "Al-Qasas",        ayahs: 88 },
  { id: 29,  name_ar: "العنكبوت",   name_en: "Al-Ankabut",      ayahs: 69 },
  { id: 30,  name_ar: "الروم",      name_en: "Ar-Rum",          ayahs: 60 },
  { id: 31,  name_ar: "لقمان",      name_en: "Luqman",          ayahs: 34 },
  { id: 32,  name_ar: "السجدة",     name_en: "As-Sajdah",       ayahs: 30 },
  { id: 33,  name_ar: "الأحزاب",    name_en: "Al-Ahzab",        ayahs: 73 },
  { id: 34,  name_ar: "سبأ",        name_en: "Saba",            ayahs: 54 },
  { id: 35,  name_ar: "فاطر",       name_en: "Fatir",           ayahs: 45 },
  { id: 36,  name_ar: "يس",         name_en: "Ya-Sin",          ayahs: 83 },
  { id: 37,  name_ar: "الصافات",    name_en: "As-Saffat",       ayahs: 182 },
  { id: 38,  name_ar: "ص",          name_en: "Sad",             ayahs: 88 },
  { id: 39,  name_ar: "الزمر",      name_en: "Az-Zumar",        ayahs: 75 },
  { id: 40,  name_ar: "غافر",       name_en: "Ghafir",          ayahs: 85 },
  { id: 41,  name_ar: "فصلت",       name_en: "Fussilat",        ayahs: 54 },
  { id: 42,  name_ar: "الشورى",     name_en: "Ash-Shura",       ayahs: 53 },
  { id: 43,  name_ar: "الزخرف",     name_en: "Az-Zukhruf",      ayahs: 89 },
  { id: 44,  name_ar: "الدخان",     name_en: "Ad-Dukhan",       ayahs: 59 },
  { id: 45,  name_ar: "الجاثية",    name_en: "Al-Jathiyah",     ayahs: 37 },
  { id: 46,  name_ar: "الأحقاف",    name_en: "Al-Ahqaf",        ayahs: 35 },
  { id: 47,  name_ar: "محمد",       name_en: "Muhammad",        ayahs: 38 },
  { id: 48,  name_ar: "الفتح",      name_en: "Al-Fath",         ayahs: 29 },
  { id: 49,  name_ar: "الحجرات",    name_en: "Al-Hujurat",      ayahs: 18 },
  { id: 50,  name_ar: "ق",          name_en: "Qaf",             ayahs: 45 },
  { id: 51,  name_ar: "الذاريات",   name_en: "Adh-Dhariyat",    ayahs: 60 },
  { id: 52,  name_ar: "الطور",      name_en: "At-Tur",          ayahs: 49 },
  { id: 53,  name_ar: "النجم",      name_en: "An-Najm",         ayahs: 62 },
  { id: 54,  name_ar: "القمر",      name_en: "Al-Qamar",        ayahs: 55 },
  { id: 55,  name_ar: "الرحمن",     name_en: "Ar-Rahman",       ayahs: 78 },
  { id: 56,  name_ar: "الواقعة",    name_en: "Al-Waqiah",       ayahs: 96 },
  { id: 57,  name_ar: "الحديد",     name_en: "Al-Hadid",        ayahs: 29 },
  { id: 58,  name_ar: "المجادلة",   name_en: "Al-Mujadilah",    ayahs: 22 },
  { id: 59,  name_ar: "الحشر",      name_en: "Al-Hashr",        ayahs: 24 },
  { id: 60,  name_ar: "الممتحنة",   name_en: "Al-Mumtahanah",   ayahs: 13 },
  { id: 61,  name_ar: "الصف",       name_en: "As-Saff",         ayahs: 14 },
  { id: 62,  name_ar: "الجمعة",     name_en: "Al-Jumuah",       ayahs: 11 },
  { id: 63,  name_ar: "المنافقون",  name_en: "Al-Munafiqun",    ayahs: 11 },
  { id: 64,  name_ar: "التغابن",    name_en: "At-Taghabun",     ayahs: 18 },
  { id: 65,  name_ar: "الطلاق",     name_en: "At-Talaq",        ayahs: 12 },
  { id: 66,  name_ar: "التحريم",    name_en: "At-Tahrim",       ayahs: 12 },
  { id: 67,  name_ar: "الملك",      name_en: "Al-Mulk",         ayahs: 30 },
  { id: 68,  name_ar: "القلم",      name_en: "Al-Qalam",        ayahs: 52 },
  { id: 69,  name_ar: "الحاقة",     name_en: "Al-Haqqah",       ayahs: 52 },
  { id: 70,  name_ar: "المعارج",    name_en: "Al-Maarij",       ayahs: 44 },
  { id: 71,  name_ar: "نوح",        name_en: "Nuh",             ayahs: 28 },
  { id: 72,  name_ar: "الجن",       name_en: "Al-Jinn",         ayahs: 28 },
  { id: 73,  name_ar: "المزمل",     name_en: "Al-Muzzammil",    ayahs: 20 },
  { id: 74,  name_ar: "المدثر",     name_en: "Al-Muddaththir",  ayahs: 56 },
  { id: 75,  name_ar: "القيامة",    name_en: "Al-Qiyamah",      ayahs: 40 },
  { id: 76,  name_ar: "الإنسان",    name_en: "Al-Insan",        ayahs: 31 },
  { id: 77,  name_ar: "المرسلات",   name_en: "Al-Mursalat",     ayahs: 50 },
  { id: 78,  name_ar: "النبأ",      name_en: "An-Naba",         ayahs: 40 },
  { id: 79,  name_ar: "النازعات",   name_en: "An-Naziat",       ayahs: 46 },
  { id: 80,  name_ar: "عبس",        name_en: "Abasa",           ayahs: 42 },
  { id: 81,  name_ar: "التكوير",    name_en: "At-Takwir",       ayahs: 29 },
  { id: 82,  name_ar: "الانفطار",   name_en: "Al-Infitar",      ayahs: 19 },
  { id: 83,  name_ar: "المطففين",   name_en: "Al-Mutaffifin",   ayahs: 36 },
  { id: 84,  name_ar: "الانشقاق",   name_en: "Al-Inshiqaq",     ayahs: 25 },
  { id: 85,  name_ar: "البروج",     name_en: "Al-Buruj",        ayahs: 22 },
  { id: 86,  name_ar: "الطارق",     name_en: "At-Tariq",        ayahs: 17 },
  { id: 87,  name_ar: "الأعلى",     name_en: "Al-Ala",          ayahs: 19 },
  { id: 88,  name_ar: "الغاشية",    name_en: "Al-Ghashiyah",    ayahs: 26 },
  { id: 89,  name_ar: "الفجر",      name_en: "Al-Fajr",         ayahs: 30 },
  { id: 90,  name_ar: "البلد",      name_en: "Al-Balad",        ayahs: 20 },
  { id: 91,  name_ar: "الشمس",      name_en: "Ash-Shams",       ayahs: 15 },
  { id: 92,  name_ar: "الليل",      name_en: "Al-Layl",         ayahs: 21 },
  { id: 93,  name_ar: "الضحى",      name_en: "Ad-Duha",         ayahs: 11 },
  { id: 94,  name_ar: "الشرح",      name_en: "Ash-Sharh",       ayahs: 8 },
  { id: 95,  name_ar: "التين",      name_en: "At-Tin",          ayahs: 8 },
  { id: 96,  name_ar: "العلق",      name_en: "Al-Alaq",         ayahs: 19 },
  { id: 97,  name_ar: "القدر",      name_en: "Al-Qadr",         ayahs: 5 },
  { id: 98,  name_ar: "البينة",     name_en: "Al-Bayyinah",     ayahs: 8 },
  { id: 99,  name_ar: "الزلزلة",    name_en: "Al-Zalzalah",     ayahs: 8 },
  { id: 100, name_ar: "العاديات",   name_en: "Al-Adiyat",       ayahs: 11 },
  { id: 101, name_ar: "القارعة",    name_en: "Al-Qariah",       ayahs: 11 },
  { id: 102, name_ar: "التكاثر",    name_en: "At-Takathur",     ayahs: 8 },
  { id: 103, name_ar: "العصر",      name_en: "Al-Asr",          ayahs: 3 },
  { id: 104, name_ar: "الهمزة",     name_en: "Al-Humazah",      ayahs: 9 },
  { id: 105, name_ar: "الفيل",      name_en: "Al-Fil",          ayahs: 5 },
  { id: 106, name_ar: "قريش",       name_en: "Quraysh",         ayahs: 4 },
  { id: 107, name_ar: "الماعون",    name_en: "Al-Maun",         ayahs: 7 },
  { id: 108, name_ar: "الكوثر",     name_en: "Al-Kawthar",      ayahs: 3 },
  { id: 109, name_ar: "الكافرون",   name_en: "Al-Kafirun",      ayahs: 6 },
  { id: 110, name_ar: "النصر",      name_en: "An-Nasr",         ayahs: 3 },
  { id: 111, name_ar: "المسد",      name_en: "Al-Masad",        ayahs: 5 },
  { id: 112, name_ar: "الإخلاص",    name_en: "Al-Ikhlas",       ayahs: 4 },
  { id: 113, name_ar: "الفلق",      name_en: "Al-Falaq",        ayahs: 5 },
  { id: 114, name_ar: "الناس",      name_en: "An-Nas",          ayahs: 6 },
];

const I18N_DICTIONARY = {
  ar: {
    // Brand & App Titles
    brand_name: 'رفيق الحفظ',
    brand_slogan: 'رفيقك اليومي في رحلة حفظ القرآن الكريم',
    app_title_dashboard: 'رفيق الحفظ — دفتر اليوم',
    app_title_auth: 'رفيق الحفظ — تسجيل الدخول والإعداد',
    app_title_hifz: 'الحفظ الجديد — رفيق الحفظ',
    app_title_tikrar: 'تكرار حفظ الأمس — رفيق الحفظ',
    app_title_rabt: 'الربط — رفيق الحفظ',
    app_title_murajaah: 'المراجعة — رفيق الحفظ',
    app_title_flashcards: 'المعالجة وبطاقات الأخطاء — رفيق الحفظ',
    app_title_history: 'سجل الأخطاء وتاريخ الإتقان — رفيق الحفظ',

    // Header buttons & tooltips
    theme_toggle_title_light: 'الوضع الحالي: فاتح (انقر للتحويل إلى الداكن)',
    theme_toggle_title_dark: 'الوضع الحالي: داكن (انقر للتحويل إلى الفاتح)',
    sound_toggle_title_on: 'المؤثرات الصوتية: مفعّلة (انقر للكتم)',
    sound_toggle_title_off: 'المؤثرات الصوتية: مكتومة (انقر للتفعيل)',
    wakelock_title_on: 'إبقاء الشاشة مضاءة: مفعّل (لن تنطفئ الشاشة أثناء التلاوة)',
    wakelock_title_off: 'إبقاء الشاشة مضاءة: متوقف (ستنطفئ الشاشة بشكل طبيعي)',
    history_btn_title: 'سجل الأخطاء وتاريخ الإتقان',
    settings_btn_title: 'الإعدادات والخيارات',
    lang_toggle_title: 'Switch language to English',
    lang_toggle_btn_text: 'EN',
    lang_switched_toast: 'تم تغيير لغة التطبيق إلى العربية 🇸🇦',

    // Settings Dropdown
    menu_edit_plan: 'تعديل خطة المراجعة والحفظ',
    menu_wakelock: 'إبقاء الشاشة مضاءة دائماً',
    menu_lang_toggle: 'تغيير اللغة إلى English',
    menu_reset_account: 'تصفير الحساب والبدء من الصفر',
    menu_logout: 'تسجيل الخروج',

    // PWA Installation
    install_app_btn: '📲 تثبيت التطبيق',
    install_app_title: 'تثبيت رفيق الحفظ على هاتفك',
    install_banner_title: 'ثبّت التطبيق على جوالك لتجربة أسرع وأسهل وصولاً',
    install_banner_desc: 'يمكنك تثبيت رفيق الحفظ على شاشتك الرئيسية كأي تطبيق أصيل للمتابعة اليومية المباشرة.',
    install_banner_btn: '📲 تثبيت الآن',
    install_banner_dismiss: 'لاحقاً',
    install_modal_title: 'تثبيت رفيق الحفظ على هاتفك',
    android_install_tab: 'هواتف أندرويد (Chrome)',
    ios_install_tab: 'هواتف آيفون (Safari)',
    desktop_install_tab: 'كمبيوتر (Chrome / Edge)',
    android_install_step1: 'اضغط على زر القائمة (الثلاث نقاط ⋮) في أعلى المتصفح.',
    android_install_step2: 'اختر «الإضافة إلى الشاشة الرئيسية» (Add to Home screen) أو «تثبيت التطبيق».',
    android_install_step3: 'اضغط «إضافة» وسيتم تثبيت التطبيق فوراً ليعمل كأي تطبيق أصيل بملء الشاشة!',
    desktop_install_step1: 'انقر على أيقونة التثبيت (⊕) في شريط العنوان أعلى المتصفح.',
    desktop_install_step2: 'أو اضغط على قائمة المتصفح (الثلاث نقاط ⋮) واختر «تثبيت رفيق الحفظ» (Install).',
    desktop_install_step3: 'اضغط «تثبيت» وسيفتح التطبيق فوراً في نافذة مستقلة وسريعة كأي برنامج أصيل!',
    install_quick_btn: '⚡ محاولة التثبيت التلقائي الفوري',
    install_quick_hint: 'إذا ظهر تنبيه المتصفح «تعذر تثبيت التطبيق»، اتبع الخطوات السريعة أدناه:',
    install_modal_note: '💡 ملاحظة: خيار «الإضافة إلى الشاشة الرئيسية» من قائمة المتصفح يثبّت التطبيق فوراً على هاتفك ليعمل كتطبيق أصيل مستقل مع أيقونة المصحف وبملء الشاشة!',
    install_insecure_title: '⚠️ اتصال غير آمن (http://)',
    install_insecure_desc: 'لتثبيت التطبيق كأيقونة مستقلة بملء الشاشة، افتح الموقع عبر الرابط الآمن (https://) ثم أعد المحاولة.',
    ios_install_modal_title: 'تثبيت التطبيق على جهازك (iPhone / iPad)',
    ios_install_step1: 'اضغط على زر المشاركة (Share ⎋) في شريط متصفح Safari.',
    ios_install_step2: 'مرر للأسفل واختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen ⊞).',
    ios_install_step3: 'اضغط «إضافة» (Add) في الزاوية العلوية وسيظهر التطبيق كأيقونة على شاشتك الرئيسية.',
    ios_install_modal_close: 'فهمت ذلك',
    app_installed_toast: '🎉 تم تثبيت التطبيق بنجاح على جهازك!',

    // Back & Nav
    back_to_tasks: 'العودة للمهام',
    back_to_dashboard: 'العودة لدفتر اليوم',
    back_to_home: 'العودة للرئيسية',
    nav_home: 'الرئيسية',
    nav_hifz: 'حفظ جديد',
    nav_tikrar: 'تكرار الأمس',
    nav_rabt: 'الربط',
    nav_murajaah: 'المراجعة',
    nav_flashcards: 'البطاقات',
    nav_history: 'السجل',

    // Dashboard
    streak_active: 'التزام مستمر',
    focus_card_title: 'خطة تلاوة اليوم',
    focus_card_desc: 'أكمل تلاوة صفحات المهام وسجل أي تعثرات لتدريبها في بطاقات المعالجة',
    btn_quick_plan: '⚙️ تعديل الخطة',
    btn_start_hifz: 'ابدأ بالحفظ الجديد ←',
    stat_current_hifz: 'صفحة الحفظ الحالية',
    stat_target_plan: 'خطة المراجعة (انقر لتعديل المدة)',
    stat_active_mistakes: 'أخطاء قيد المعالجة (عرض السجل)',
    today_tasks_title: 'مهام التلاوة لليوم',
    today_tasks_sub: 'انقر على أي مهمة للانتقال إلى صفحتها المستقلة ومتابعة تلاوة صفحاتها',
    tasks_loading: 'جاري إعداد مهام اليوم…',
    greeting_prefix: 'مرحباً، ',
    page_unit: 'صفحة',
    pages_unit: 'صفحات',
    active_mistakes_unit: 'خطأ نشط',
    khatm_every_days: 'ختم كل {days} أيام ({pages} ص / اليوم ≈ {hizb} أحزاب)',

    // Task Cards
    task_hifz_title: 'الحفظ الجديد',
    task_hifz_sub: 'صفحة جديدة اليوم',
    task_tikrar_title: 'تكرار حفظ الأمس',
    task_tikrar_sub: 'تكرار ١٠ مرات لتثبيت الحفظ قبل الربط',
    task_rabt_title: 'الربط',
    task_rabt_sub: 'نافذة الربط المستمرة',
    task_murajaah_title: 'المراجعة',
    task_murajaah_sub: 'ختم دوري مقسم على الأيام',
    card_tikrar_title: '🟡 تكرار حفظ الأمس (تثبيت ١٠ مرات)',
    badge_tikrar_title: '🟡 تكرار حفظ الأمس (تثبيت ١٠ مرات)',
    stage_meta_tikrar: 'تكرار صفحة الأمس ١٠ مرات قبل أن تنضم إلى الربط',
    btn_add_repetition: '🔁 تسجيل تكرار (+1)',
    btn_undo_repetition: '↩ تراجع (-1)',
    btn_complete_all_repetitions: '✓ أتممت الـ ١٠ تكرارات كاملة',
    repetition_count_label: '{count} من {total} تكرارات',
    repetition_count_pill: '{count} / {total} تكرار',
    tikrar_celebration_toast: '🎉 مبارك! أتممت تكرار حفظ الأمس ١٠ مرات بنجاح، وانضمت الصفحة إلى الربط!',
    tikrar_page_recited_toast: 'تم تسجيل التكرار رقم {count} من {total} بنجاح ✓',
    tikrar_page_undone_toast: 'تم التراجع عن التكرار ({count} من {total}) ↩',
    tikrar_inactive_head: 'لا يوجد تكرار لحفظ الأمس اليوم',
    tikrar_inactive_desc: 'تكرار حفظ الأمس يتطلب إتمام صفحة جديدة في الحفظ الجديد أولاً لتظهر هنا في اليوم التالي.',
    tikrar_done_badge: '✓ أتممت التكرار ١٠ مرات وانضمت الصفحة للربط',
    btn_go_to_rabt: 'الانتقال إلى الربط ←',
    card_rabt_title: '🔵 الربط (نافذة الربط المستمرة)',
    card_murajaah_title: '🟣 المراجعة اليومية',
    "card_muraja'ah_title": '🟣 المراجعة اليومية',
    card_hifz_title: '🟢 الحفظ الجديد',
    badge_rabt_title: '🔵 الربط (نافذة الربط المستمرة)',
    badge_murajaah_title: '🟣 المراجعة اليومية',
    badge_hifz_title: '🟢 الحفظ الجديد',
    card_flashcards_title: '🔴 المعالجة وتدريب البطاقات',
    badge_flashcards_title: '🔴 المعالجة وتدريب البطاقات',
    task_mistakes_title: 'المعالجة',
    task_mistakes_sub: 'تدريب البطاقات الذكية',
    task_open_arrow: 'فتح صفحة التلاوة المستقلة ←',
    task_status_done_today: '✓ مكتمل اليوم',
    task_status_inactive: 'غير مفعّل',
    task_status_inactive_today: 'غير مفعّل اليوم',
    task_status_ready_train: 'متاح للتدريب',
    task_status_deck_done: 'رائـع! مكتمل',
    task_flag_carried: 'محولة من أمس',
    task_progress_title: 'التقدم الفردي للعملية',
    task_progress_deck_title: 'بطاقات التدريب',
    task_progress_deck_active: '{count} نشطة',
    task_mistakes_need_practice: '{count} خطأ بحاجة للإتقان',
    task_no_mistakes: 'لا توجد أخطاء نشطة ✓',
    single_page_format: 'صفحة {page}',
    multi_page_format: 'صفحات {start} – {end}',
    page_count_progress: '{count} من {total} صفحة ({percent}%)',
    page_count_pill: '{count} / {total} صفحة',

    // Task Dedicated Pages
    task_inactive_head: 'هذه المهمة غير نشطة اليوم',
    task_inactive_desc: 'حسب مسار خطتك الحالي، هذه المهمة لا تتطلب إنجازاً اليوم.',
    required_range_hint: 'النطاق المطلوب: من صفحة <strong>{start}</strong> إلى <strong>{end}</strong>',
    all_pages_completed: '✓ أنجزت جميع صفحات اليوم',
    pages_completed_badge: '{count} من {total} صفحة منجزة',
    daily_recitation_progress: 'تقدم التلاوة اليومي',
    chips_title_text: 'اختر صفحة للتلاوة أو تسجيل خطأ:',
    chips_hint_text: 'كل صفحة تُتلى وتُحدد تُسجل كصفحة منجزة بشكل فردي',
    stage_page_label: '📖 صفحة {page}',
    stage_page_recited: '✓ تمت تلاوتها',
    stage_page_pending: 'بانتظار التلاوة',
    stage_meta_hifz: 'الحفظ الجديد (صفحة اليوم)',
    stage_meta_range: 'صفحة داخل نطاق {task}',
    stage_warning_mistakes: '⚠ لديك <strong>{count}</strong> أخطاء سابقة مسجلة على هذه الصفحة. ركز عليها أثناء التلاوة!',
    btn_complete_page_init: '✓ تمت تلاوة الصفحة (إتمام)',
    btn_complete_page_reconfirm: '✓ تم إتمام هذه الصفحة (إعادة التأكيد)',
    btn_view_mushaf: '📖 تصفح المصحف',
    btn_open_mistake: '🔴 سجل خطأ',
    btn_prev_page: 'السابقة ({page})',
    btn_next_page: 'التالية ({page})',
    btn_undo_page: '↩ التراجع عن إتمام الصفحة',
    btn_undo_page_title: 'إلغاء وسم هذه الصفحة كمنجزة وإعادتها كصفحة غير متلوة',
    kbd_hints: '<span>مفاتيح سريعة:</span> <kbd>→</kbd> <kbd>←</kbd> للتنقل | <kbd>Enter</kbd> للإتمام | <kbd>U</kbd> للتراجع | <kbd>M</kbd> لتسجيل خطأ',
    page_completed_toast: 'تم تسجيل إتمام صفحة {page} بنجاح ✓',
    page_undone_toast: 'تم التراجع عن إتمام صفحة {page} بنجاح ↩',
    undo_in_progress: 'جاري التراجع…',
    task_celebration_toast: '🎉 مبارك! تم إنجاز جميع صفحات {title} لليوم!',

    // Plan Modal
    plan_modal_title: 'تعديل خطة المراجعة والحفظ',
    plan_days_label: 'كم يوماً تريد لختم مراجعتك كاملة؟ (١ – ٦ أيام كحد أقصى)',
    day_1: 'يوم واحد',
    day_2: 'يومان',
    day_3: '٣ أيام',
    day_4: '٤ أيام',
    day_5: '٥ أيام',
    day_6: '٦ أيام',
    plan_calc_inactive: '📊 <strong>المراجعة غير نشطة حالياً:</strong> ستنطلق المراجعة الدورية تلقائياً بعد تجاوز أول ٣٠ صفحة حفظ.',
    plan_calc_active: '📊 <strong>الحساب التلقائي:</strong> إجمالي صفحات المراجعة ({pool} صفحة) مقسومة على <strong>{days} أيام</strong> = <strong>{daily} صفحة يومياً</strong> (~{hizb} أحزاب) لختم المراجعة في اليوم الأخير تماماً.',
    plan_calc_default: '📊 <strong>الحساب التلقائي:</strong> سيتم قسمة صفحات المراجعة المتاحة بالتساوي لتصل إلى هدفك في اليوم الأخير.',
    plan_current_page_label: 'صفحة الحفظ الحالية في المصحف (1 - 604)',
    plan_current_page_ph: 'مثال: 250',
    plan_rabt_hint: 'نطاق الربط يبدأ من ٣٠ صفحة ويتوسع مع كل صفحة حفظ جديدة حتى اكتمال دورة المراجعة.',
    plan_user_type_label: 'تصنيف خطة الحفظ',
    plan_type_new: 'حافظ جديد (يبدأ من البداية)',
    plan_type_existing: 'حافظ متقدم (حفظ سابق مستمر)',
    plan_type_complete: 'خاتم لكتاب الله (مراجعة دورية كاملة للمصحف)',
    btn_cancel: 'إلغاء',
    btn_save_plan: 'حفظ وتطبيق الخطة',
    plan_updated_toast: 'تم تحديث خطة المراجعة بنجاح 🎯',

    // Reset Modal
    reset_modal_title: 'تصفير الحساب والبدء من الصفر',
    reset_warning_1: 'تنبيه هام لا يمكن التراجع عنه:',
    reset_warning_2: 'تصفير الحساب يعني مسح جميع المهام وسجلات التلاوة اليومية، وحذف كافة الأخطاء والبطاقات المسجلة، وإعادة صفحة الحفظ الحالية والهدف إلى نقطة البداية (الصفر).',
    reset_warning_3: 'هل أنت متأكد تماماً من رغبتك في البدء من جديد؟',
    btn_cancel_reset: 'إلغاء وتراجع',
    btn_confirm_reset: 'نعم، صفّر كل شيء وابدأ من جديد',
    resetting_in_progress: 'جاري التصفير…',
    reset_success_toast: 'تم تصفير الحساب ومسح جميع السجلات بنجاح 🔄',

    // Mistake Modal
    mistake_modal_title: 'سجل خطأ أثناء التلاوة',
    mistake_select_surah: 'السورة',
    mistake_surah_placeholder: '— اختر السورة —',
    mistake_select_ayah: 'رقم الآية',
    mistake_ayah_placeholder: '— اختر الآية —',
    mistake_ayah_option: 'الآية {num}',
    mistake_type_label: 'نوع الخطأ / التعثر',
    mistake_notes_label: 'ملاحظات إضافية (اختياري)',
    mistake_notes_ph: 'اكتب الكلمة التي تعثرت فيها أو الآية المشابهة…',
    btn_save_mistake: 'حفظ الخطأ في البطاقات الذكية',
    mistake_select_required: 'يرجى اختيار السورة ورقم الآية أولاً',
    mistake_logged_toast: 'تم تسجيل الخطأ بنجاح 🔴 وسيظهر في بطاقات المعالجة',
    ayah_chips_label: 'آيات هذه الصفحة (انقر للاختيار المباشر):',
    btn_show_all_ayahs: 'عرض جميع آيات السورة ({total} آية)',
    btn_show_page_ayahs_only: 'الاقتصار على آيات الصفحة ({count} آية)',
    optgroup_page_surahs: 'سور هذه الصفحة',
    optgroup_all_surahs: 'باقي سور القرآن',

    // Mistake Types
    tag_transition: 'انقطاع/نسيان بداية الآية',
    tag_mutashabihat: 'مشتبهات',
    tag_tawaqquf: 'أحكام الوقف',
    tag_tashkeel: 'التشكيل',
    tag_lafdh: 'اللفظ',

    // Mushaf Modal
    mushaf_modal_title: '📖 مصحف المدينة — صفحة {page}',
    mushaf_open_external: 'فتح على Quran.com ↗',
    mushaf_offline_error: 'تعذر تحميل صورة الصفحة في وضع عدم الاتصال',
    mushaf_offline_hint: 'يمكنك تلاوة الصفحة مباشرة من مصحفك أو النقر أدناه لفتحها على الويب:',
    mushaf_open_btn: 'فتح الصفحة على Quran.com',

    // Flashcards Page
    fc_head_title: '🔴 تدريب بطاقات الأخطاء السابقة',
    fc_head_desc: 'كرر تلاوة الآيات التي سُجلت عليها أخطاء حتى تتقنها وتنتقل تلقائياً إلى الأرشيف.',
    fc_btn_view_history: '📜 عرض الأخطاء المتقنة',
    fc_counter_loading: 'البطاقات',
    fc_counter_label: 'البطاقة {current} من {total}',
    fc_loading_text: 'جاري تحميل رزمة البطاقات الذكية…',
    fc_empty_title: 'مبارك! لا توجد أخطاء نشطة بانتظار المعالجة',
    fc_empty_desc: 'تم إتقان جميع الأخطاء المسجلة أو لم يتم تسجيل أي أخطاء جديدة اليوم.',
    fc_card_hint_front: '💡 انقر على البطاقة لقلبها وقراءة الملاحظة والتأكد من الصواب',
    fc_card_notes_label: '📝 الملاحظات والتنبيهات:',
    fc_card_no_notes: 'لا توجد ملاحظات مسجلة لهذه البطاقة.',
    fc_card_mastery: 'مرات الإتقان: {count}',
    fc_card_logged_date: ' · سُجلت في {date}',
    fc_card_hint_back: 'إذا تلوتها الآن بشكل صحيح دون تعثر، اختر «أتقنتها». وإلا اختر «أعد التدريب».',
    fc_btn_mastered: '✓ أتقنتها (أرشفة الخطأ)',
    fc_btn_keep: '🔁 أعد التدريب (إبقاء)',
    fc_btn_delete: '🗑️ حذف نهائياً',
    fc_btn_delete_title: 'حذف هذا الخطأ نهائياً بعد إتقانه',
    fc_btn_reveal: '🔍 اقلب البطاقة لرؤية الملاحظات',
    fc_delete_confirm: 'هل أنت متأكد من حذف هذه البطاقة وسجل هذا الخطأ نهائياً؟',
    fc_toast_deleted: 'تم حذف البطاقة نهائياً بنجاح 🗑️',
    fc_toast_mastered: 'أتقنتها بنجاح! انتقلت إلى الأرشيف ✓',
    fc_toast_recycled: 'البطاقة عادت إلى نهاية رزمة التدريب 🔁',

    // History Page
    history_head_title: '📜 سجل الأخطاء وتاريخ الإتقان',
    history_kpi_archived_label: 'أخطاء تم إتقانها وأرشفتها',
    history_kpi_active_label: 'أخطاء قيد المتابعة والتدريب',
    history_kpi_rate_label: 'نسبة الإتقان العامة',
    history_btn_analytics: '📊 إحصائيات مواضع التكرار',
    history_top_ayahs: 'أكثر الآيات تكراراً للأخطاء',
    history_top_surahs: 'أكثر السور تكراراً للأخطاء',
    history_search_ph: 'بحث برقم السورة، الصفحة، أو الملاحظة…',
    history_tab_archived: 'المتقنة (الأرشيف)',
    history_tab_active: 'قيد المعالجة (النشطة)',
    history_tab_all: 'الكل',
    history_badge_mastered: 'تم الإتقان والأرشفة',
    history_badge_active: 'قيد المعالجة',
    history_logged_date: 'تاريخ التسجيل: {date}',
    history_mastered_date: 'تاريخ الإتقان: {date}',
    history_reactivate_btn: 'إعادة إلى التدريب النشط 🔁',
    history_delete_btn: 'حذف السجل نهائياً 🗑️',
    history_delete_confirm: 'هل أنت متأكد من حذف هذا السجل نهائياً؟ لن يظهر مجدداً في السجل أو البطاقات.',
    history_toast_reactivated: 'تمت إعادة الخطأ إلى رزمة البطاقات النشطة بنجاح 🔁',
    history_toast_deleted: 'تم حذف السجل نهائياً بنجاح 🗑️',
    history_empty_feed: 'لا توجد سجلات تطابق الفلتر الحالي.',
    history_no_weak_ayahs: 'لا توجد آيات مكررة كافية بعد.',
    history_no_weak_surahs: 'لا توجد سور كافية بعد.',
    times_count: '{count} مرات',
    mistakes_count_label: '{count} أخطاء',
    history_btn_toggle_analytics: 'إخفاء / إظهار التحليلات',
    history_btn_practice_now: 'تدريب الآن ←',
    history_feed_loading: 'جاري تحميل سجل الأخطاء المتقنة…',

    // Auth Page (index.html)
    tab_register: 'إنشاء حساب',
    tab_login: 'تسجيل الدخول',
    lbl_name: 'الاسم',
    ph_name: 'اسمك الكريم',
    lbl_email: 'البريد الإلكتروني',
    ph_email: 'example@mail.com',
    lbl_password: 'كلمة المرور',
    ph_password: '٨ أحرف على الأقل',
    ph_password_login: 'كلمة المرور',
    legend_user_type: 'نوع الحفظ',
    type_new_title: 'جديد',
    type_new_sub: 'أبدأ الحفظ من البداية',
    type_existing_title: 'أحفظ مسبقاً',
    type_existing_sub: 'حدّد الصفحة التي وصلت إليها',
    type_complete_title: 'حافظ كامل',
    type_complete_sub: 'أنهيت ٦٠٤ صفحة',
    lbl_existing_page: 'صفحة الحفظ الحالية (١ – ٦٠٤)',
    ph_existing_page: 'مثال: ٢٧٥',
    lbl_murajaah_days: 'المدة المرغوبة لختم المراجعة دورياً (١ – ٦ أيام كحد أقصى)',
    opt_day_1: 'ختم في يوم واحد (ورد مكثف)',
    opt_day_2: 'ختم كل يومين',
    opt_day_3: 'ختم كل ٣ أيام',
    opt_day_4: 'ختم كل ٤ أيام',
    opt_day_5: 'ختم كل ٥ أيام',
    opt_day_6: 'ختم كل ٦ أيام (الموصى به)',
    hint_murajaah_days: 'يقوم النظام تلقائياً بحساب وقسمة صفحات المراجعة لتختم في اليوم الأخير.',
    btn_submit_register: 'إنشاء الحساب',
    btn_submit_login: 'دخول',
    auth_welcome_toast: 'تم إنشاء الحساب بنجاح! مرحباً بك 📖',
    auth_login_toast: 'تم تسجيل الدخول بنجاح ✓',

    // Common Toasts & Labels
    toast_theme_light: 'تم التحويل إلى الوضع الفاتح ☀️',
    toast_theme_dark: 'تم التحويل إلى الوضع الداكن 🌙',
    toast_sound_on: 'تم تفعيل المؤثرات الصوتية 🔊',
    toast_sound_off: 'تم كتم المؤثرات الصوتية 🔇',
    toast_wake_on: 'تم تفعيل إبقاء الشاشة مضاءة 💡',
    toast_wake_off: 'تم إيقاف إبقاء الشاشة مضاءة',
    juz_label: 'الجزء {num}',
    hizb_label: 'الحزب {num}',
    rub_label: 'ربع الحزب {num}',
    ayah_label: 'الآية {num}',
    surah_prefix: 'سورة ',
    page_prefix: 'صفحة ',
    err_network: 'تعذر الاتصال بالخادم. يرجى التحقق من الاتصال.',
    err_session_expired: 'انتهت الجلسة. يرجى تسجيل الدخول مجدداً.',
    err_unexpected: 'حدث خطأ غير متوقع.',
  },

  en: {
    // Brand & App Titles
    brand_name: 'Rafeequl Hifz',
    brand_slogan: 'Your daily companion in Quran memorization',
    app_title_dashboard: 'Rafeequl Hifz — Daily Logbook',
    app_title_auth: 'Rafeequl Hifz — Sign In & Setup',
    app_title_hifz: 'New Memorization — Rafeequl Hifz',
    app_title_tikrar: "Yesterday's Repetition — Rafeequl Hifz",
    app_title_rabt: 'Rabt (Linking) — Rafeequl Hifz',
    app_title_murajaah: 'Revision — Rafeequl Hifz',
    app_title_flashcards: 'Flashcards & Practice — Rafeequl Hifz',
    app_title_history: 'Mastery & Mistake Logbook — Rafeequl Hifz',

    // Header buttons & tooltips
    theme_toggle_title_light: 'Current mode: Light (Click to switch to Dark)',
    theme_toggle_title_dark: 'Current mode: Dark (Click to switch to Light)',
    sound_toggle_title_on: 'Sound Feedback: On (Click to mute)',
    sound_toggle_title_off: 'Sound Feedback: Muted (Click to enable)',
    wakelock_title_on: 'Keep Screen Awake: Active (Screen stays on during recitation)',
    wakelock_title_off: 'Keep Screen Awake: Inactive (Screen dims normally)',
    history_btn_title: 'Mistake Logbook & Mastery History',
    settings_btn_title: 'Settings & Options',
    lang_toggle_title: 'تبديل اللغة إلى العربية',
    lang_toggle_btn_text: 'عربي',
    lang_switched_toast: 'Language switched to English 🇬🇧',

    // Settings Dropdown
    menu_edit_plan: 'Edit Revision & Memorization Plan',
    menu_wakelock: 'Keep Screen Always Awake',
    menu_lang_toggle: 'تغيير اللغة إلى العربية',
    menu_reset_account: 'Reset Account & Start Fresh',
    menu_logout: 'Sign Out',

    // PWA Installation
    install_app_btn: '📲 Install App',
    install_app_title: 'Install Rafeequl Hifz on your phone',
    install_banner_title: 'Install on your mobile for a fast, standalone experience',
    install_banner_desc: 'Install Rafeequl Hifz on your home screen for quick daily Quran tracking without the browser bar.',
    install_banner_btn: '📲 Install Now',
    install_banner_dismiss: 'Later',
    install_modal_title: 'Install Rafeequl Hifz on your device',
    android_install_tab: 'Android (Chrome)',
    ios_install_tab: 'iPhone / iPad (Safari)',
    desktop_install_tab: 'Desktop (Chrome / Edge)',
    android_install_step1: 'Tap the menu icon (three dots ⋮) at the top of Chrome.',
    android_install_step2: 'Select «Add to Home screen» (or «Install app»).',
    android_install_step3: 'Tap «Add» or «Install», and the app will be pinned directly to your home screen to run in full screen!',
    desktop_install_step1: 'Click the install icon (⊕) in the browser address bar at the top.',
    desktop_install_step2: 'Or click the browser menu (three dots ⋮) and select «Install Rafeequl Hifz».',
    desktop_install_step3: 'Click «Install» and the app will open in a fast, standalone desktop window!',
    install_quick_btn: '⚡ Try 1-Click Install',
    install_quick_hint: 'If you see an "App cannot be installed" notice, use the simple steps below:',
    install_modal_note: '💡 Note: Using «Add to Home screen» from your browser menu (⋮) installs Rafeequl Hifz directly to your home screen as a standalone full-screen app!',
    install_insecure_title: '⚠️ Insecure connection (http://)',
    install_insecure_desc: 'To install the app as a full-screen standalone icon, open the site over the secure link (https://) and try again.',
    ios_install_modal_title: 'Install on iPhone / iPad',
    ios_install_step1: 'Tap the Share icon (⎋) in the Safari toolbar.',
    ios_install_step2: 'Scroll down and tap «Add to Home Screen» (⊞).',
    ios_install_step3: 'Tap «Add» in the top corner to install Rafeequl Hifz on your home screen.',
    ios_install_modal_close: 'Got it',
    app_installed_toast: '🎉 App installed successfully!',

    // Back & Nav
    back_to_tasks: 'Back to Tasks',
    back_to_dashboard: 'Back to Daily Logbook',
    back_to_home: 'Back to Home',
    nav_home: 'Home',
    nav_hifz: 'New Hifz',
    nav_tikrar: 'Yesterday',
    nav_rabt: 'Rabt',
    nav_murajaah: 'Revision',
    nav_flashcards: 'Flashcards',
    nav_history: 'Logbook',

    // Dashboard
    streak_active: 'Active Streak',
    focus_card_title: "Today's Recitation Plan",
    focus_card_desc: 'Complete task pages and record any stumbles for flashcard practice',
    btn_quick_plan: '⚙️ Edit Plan',
    btn_start_hifz: 'Start New Memorization →',
    stat_current_hifz: 'Current Hifz Page',
    stat_target_plan: 'Revision Plan (Click to edit)',
    stat_active_mistakes: 'Active Mistakes (View Log)',
    today_tasks_title: "Today's Recitation Tasks",
    today_tasks_sub: 'Click any task to open its dedicated page and track recitation.',
    tasks_loading: "Preparing today's tasks…",
    greeting_prefix: 'Welcome, ',
    page_unit: 'page',
    pages_unit: 'pages',
    active_mistakes_unit: 'active mistakes',
    khatm_every_days: 'Complete every {days} days ({pages} p / day ≈ {hizb} hizbs)',

    // Task Cards
    task_hifz_title: 'New Memorization',
    task_hifz_sub: 'New page today',
    task_tikrar_title: "Yesterday's Repetition",
    task_tikrar_sub: '10 repetitions to consolidate before Rabt',
    task_rabt_title: 'Rabt (Linking)',
    task_rabt_sub: 'Continuous linking window',
    task_murajaah_title: 'Revision',
    task_murajaah_sub: 'Periodic khatm divided across days',
    card_tikrar_title: "🟡 Yesterday's Repetition (10x Consolidation)",
    badge_tikrar_title: "🟡 Yesterday's Repetition (10x Consolidation)",
    stage_meta_tikrar: "Recite yesterday's page 10 times before joining Rabt",
    btn_add_repetition: '🔁 Count Repetition (+1)',
    btn_undo_repetition: '↩ Undo (-1)',
    btn_complete_all_repetitions: '✓ Completed All 10 Repetitions',
    repetition_count_label: '{count} of {total} repetitions',
    repetition_count_pill: '{count} / {total} reps',
    tikrar_celebration_toast: '🎉 Congratulations! Completed 10 repetitions, page now joined Rabt!',
    tikrar_page_recited_toast: 'Recorded repetition {count} of {total} ✓',
    tikrar_page_undone_toast: 'Undone repetition ({count} of {total}) ↩',
    tikrar_inactive_head: 'No yesterday repetition due today',
    tikrar_inactive_desc: 'Yesterday\'s repetition requires completing a new page in New Memorization first, which will appear here tomorrow.',
    tikrar_done_badge: '✓ Completed 10 repetitions and page joined Rabt',
    btn_go_to_rabt: 'Go to Rabt (Linking) →',
    card_rabt_title: '🔵 Rabt (Linking Window)',
    card_murajaah_title: '🟣 Daily Revision',
    "card_muraja'ah_title": '🟣 Daily Revision',
    card_hifz_title: '🟢 New Memorization',
    badge_rabt_title: '🔵 Rabt (Linking Window)',
    badge_murajaah_title: '🟣 Daily Revision',
    badge_hifz_title: '🟢 New Memorization',
    card_flashcards_title: '🔴 Practice & Error Flashcards',
    badge_flashcards_title: '🔴 Practice & Error Flashcards',
    task_mistakes_title: 'Remediation',
    task_mistakes_sub: 'Smart flashcards training',
    task_open_arrow: 'Open Recitation Page →',
    task_status_done_today: '✓ Completed Today',
    task_status_inactive: 'Inactive',
    task_status_inactive_today: 'Inactive Today',
    task_status_ready_train: 'Ready to Practice',
    task_status_deck_done: 'Great! Completed',
    task_flag_carried: 'Carried over from yesterday',
    task_progress_title: 'Individual Progress',
    task_progress_deck_title: 'Practice Cards',
    task_progress_deck_active: '{count} active',
    task_mistakes_need_practice: '{count} mistakes need practice',
    task_no_mistakes: 'No active mistakes ✓',
    single_page_format: 'Page {page}',
    multi_page_format: 'Pages {start} – {end}',
    page_count_progress: '{count} of {total} pages ({percent}%)',
    page_count_pill: '{count} / {total} pages',

    // Task Dedicated Pages
    task_inactive_head: 'This task is inactive today',
    task_inactive_desc: 'Based on your current plan pace, this task does not require completion today.',
    required_range_hint: 'Required range: From page <strong>{start}</strong> to <strong>{end}</strong>',
    all_pages_completed: "✓ Completed all today's pages",
    pages_completed_badge: '{count} of {total} pages completed',
    daily_recitation_progress: 'Daily Recitation Progress',
    chips_title_text: 'Select a page to recite or log a mistake:',
    chips_hint_text: 'Each recited page is tracked individually as completed',
    stage_page_label: '📖 Page {page}',
    stage_page_recited: '✓ Recited',
    stage_page_pending: 'Pending Recitation',
    stage_meta_hifz: "New Memorization (Today's page)",
    stage_meta_range: 'Page within {task} range',
    stage_warning_mistakes: '⚠ You have <strong>{count}</strong> previous mistakes on this page. Focus on them during recitation!',
    btn_complete_page_init: '✓ Recited Page (Complete)',
    btn_complete_page_reconfirm: '✓ Page Completed (Re-confirm)',
    btn_view_mushaf: '📖 Browse Mushaf',
    btn_open_mistake: '🔴 Log Mistake',
    btn_prev_page: 'Previous ({page})',
    btn_next_page: 'Next ({page})',
    btn_undo_page: '↩ Undo Page Completion',
    btn_undo_page_title: 'Undo completion mark for this page and return it to pending',
    kbd_hints: '<span>Shortcuts:</span> <kbd>→</kbd> <kbd>←</kbd> navigate | <kbd>Enter</kbd> complete | <kbd>U</kbd> undo | <kbd>M</kbd> log mistake',
    page_completed_toast: 'Page {page} marked as completed ✓',
    page_undone_toast: 'Page {page} mark undone successfully ↩',
    undo_in_progress: 'Undoing…',
    task_celebration_toast: '🎉 Congratulations! Completed all pages of {title} for today!',

    // Plan Modal
    plan_modal_title: 'Edit Revision & Memorization Plan',
    plan_days_label: 'How many days to complete your full revision? (1–6 days max)',
    day_1: '1 Day',
    day_2: '2 Days',
    day_3: '3 Days',
    day_4: '4 Days',
    day_5: '5 Days',
    day_6: '6 Days',
    plan_calc_inactive: '📊 <strong>Revision currently inactive:</strong> Periodic revision starts automatically after passing the first 30 memorized pages.',
    plan_calc_active: '📊 <strong>Auto Calculation:</strong> Total revision pool ({pool} pages) divided by <strong>{days} days</strong> = <strong>{daily} pages/day</strong> (~{hizb} hizbs) to finish exactly on the last day.',
    plan_calc_default: '📊 <strong>Auto Calculation:</strong> Available revision pages will be divided equally to meet your goal on the last day.',
    plan_current_page_label: 'Current memorization page in Mushaf (1–604)',
    plan_current_page_ph: 'e.g. 250',
    plan_rabt_hint: 'Rabt window starts at 30 pages and expands with each new page until revision cycle completes.',
    plan_user_type_label: 'Memorization Plan Category',
    plan_type_new: 'New Memorizer (Starting from beginning)',
    plan_type_existing: 'Advanced Memorizer (Continuing prior hifz)',
    plan_type_complete: 'Complete Hafiz (Full periodic Quran revision)',
    btn_cancel: 'Cancel',
    btn_save_plan: 'Save & Apply Plan',
    plan_updated_toast: 'Revision plan updated successfully 🎯',

    // Reset Modal
    reset_modal_title: 'Reset Account & Start Fresh',
    reset_warning_1: 'Important irreversible notice:',
    reset_warning_2: 'Resetting erases all tasks, recitation history, recorded mistakes and flashcards, and resets current memorization page to zero.',
    reset_warning_3: 'Are you absolutely sure you want to start from scratch?',
    btn_cancel_reset: 'Cancel & Go Back',
    btn_confirm_reset: 'Yes, reset everything & start fresh',
    resetting_in_progress: 'Resetting…',
    reset_success_toast: 'Account reset and all records cleared successfully 🔄',

    // Mistake Modal
    mistake_modal_title: 'Log a Mistake During Recitation',
    mistake_select_surah: 'Surah',
    mistake_surah_placeholder: '— Select Surah —',
    mistake_select_ayah: 'Ayah Number',
    mistake_ayah_placeholder: '— Select Ayah —',
    mistake_ayah_option: 'Ayah {num}',
    mistake_type_label: 'Mistake / Stumble Category',
    mistake_notes_label: 'Additional Notes (Optional)',
    mistake_notes_ph: 'Write the stumbling word or similar ayah…',
    btn_save_mistake: 'Save Mistake to Smart Flashcards',
    mistake_select_required: 'Please select Surah and Ayah number first',
    mistake_logged_toast: 'Mistake logged successfully 🔴 Added to smart flashcards',
    ayah_chips_label: 'Verses on this page (click to select):',
    btn_show_all_ayahs: 'Show all verses of surah ({total} verses)',
    btn_show_page_ayahs_only: 'Limit to page verses ({count} verses)',
    optgroup_page_surahs: 'Surahs on this page',
    optgroup_all_surahs: 'All other surahs',

    // Mistake Types
    tag_transition: 'Break / Forgetting Ayah Start',
    tag_mutashabihat: 'Confusable Similar Ayat (Mutashabihat)',
    tag_tawaqquf: 'Pause Rules (Waqf)',
    tag_tashkeel: 'Diacritics (Tashkeel)',
    tag_lafdh: 'Pronunciation (Lafdh)',

    // Mushaf Modal
    mushaf_modal_title: '📖 Madinah Mushaf — Page {page}',
    mushaf_open_external: 'Open on Quran.com ↗',
    mushaf_offline_error: 'Unable to load page image offline',
    mushaf_offline_hint: 'You can recite directly from your physical Mushaf or click below to view online:',
    mushaf_open_btn: 'Open Page on Quran.com',

    // Flashcards Page
    fc_head_title: '🔴 Smart Flashcards Practice',
    fc_head_desc: 'Repeat recitation of stumbles until mastered, moving them automatically to the archive.',
    fc_btn_view_history: '📜 View Mastered History',
    fc_counter_loading: 'Cards',
    fc_counter_label: 'Card {current} of {total}',
    fc_loading_text: 'Loading smart flashcards deck…',
    fc_empty_title: 'Great! No active mistakes waiting for practice',
    fc_empty_desc: 'All recorded mistakes have been mastered or none were logged today.',
    fc_card_hint_front: '💡 Click card to flip and reveal notes & verification options',
    fc_card_notes_label: '📝 Notes & Alerts:',
    fc_card_no_notes: 'No notes logged for this card.',
    fc_card_mastery: 'Mastery count: {count}',
    fc_card_logged_date: ' · Logged on {date}',
    fc_card_hint_back: 'If recited correctly without stumble, choose "Mastered". Otherwise choose "Keep Practicing".',
    fc_btn_mastered: '✓ Mastered (Archive)',
    fc_btn_keep: '🔁 Keep Practicing (Retain)',
    fc_btn_delete: '🗑️ Delete Permanently',
    fc_btn_delete_title: 'Delete this card permanently from deck and history',
    fc_btn_reveal: '🔍 Flip card to see notes',
    fc_delete_confirm: 'Are you sure you want to permanently delete this card and its record?',
    fc_toast_deleted: 'Card permanently deleted 🗑️',
    fc_toast_mastered: 'Mastered successfully! Moved to archive ✓',
    fc_toast_recycled: 'Card moved to the end of practice deck 🔁',

    // History Page
    history_head_title: '📜 Mistake & Mastery Logbook',
    history_kpi_archived_label: 'Mastered & Archived Mistakes',
    history_kpi_active_label: 'Active Mistakes in Training',
    history_kpi_rate_label: 'Overall Mastery Rate',
    history_btn_analytics: '📊 Recurrence Analytics',
    history_top_ayahs: 'Most Frequent Mistake Ayahs',
    history_top_surahs: 'Most Frequent Mistake Surahs',
    history_search_ph: 'Search by Surah, page, or note…',
    history_tab_archived: 'Mastered (Archive)',
    history_tab_active: 'In Progress (Active)',
    history_tab_all: 'All',
    history_badge_mastered: 'Mastered & Archived',
    history_badge_active: 'In Progress',
    history_logged_date: 'Logged: {date}',
    history_mastered_date: 'Mastered: {date}',
    history_reactivate_btn: 'Return to Active Practice 🔁',
    history_delete_btn: 'Delete Permanently 🗑️',
    history_delete_confirm: 'Are you sure you want to permanently delete this record? It will no longer appear in history or cards.',
    history_toast_reactivated: 'Mistake returned to active flashcards deck 🔁',
    history_toast_deleted: 'Record permanently deleted 🗑️',
    history_empty_feed: 'No records match the current filter.',
    history_no_weak_ayahs: 'Not enough recurring ayahs recorded yet.',
    history_no_weak_surahs: 'Not enough recurring surahs recorded yet.',
    times_count: '{count} times',
    mistakes_count_label: '{count} mistakes',
    history_btn_toggle_analytics: 'Show / Hide Analytics',
    history_btn_practice_now: 'Practice Now →',
    history_feed_loading: 'Loading mistake & mastery records…',

    // Auth Page (index.html)
    tab_register: 'Create Account',
    tab_login: 'Sign In',
    lbl_name: 'Name',
    ph_name: 'Your full name',
    lbl_email: 'Email',
    ph_email: 'example@mail.com',
    lbl_password: 'Password',
    ph_password: 'At least 8 characters',
    ph_password_login: 'Password',
    legend_user_type: 'Memorization Profile',
    type_new_title: 'New',
    type_new_sub: 'Starting memorization from beginning',
    type_existing_title: 'Continuing',
    type_existing_sub: 'Specify current reached page',
    type_complete_title: 'Complete Hafiz',
    type_complete_sub: 'Completed all 604 pages',
    lbl_existing_page: 'Current Memorization Page (1–604)',
    ph_existing_page: 'e.g. 275',
    lbl_murajaah_days: 'Desired days to complete periodic revision (1–6 days max)',
    opt_day_1: 'Finish in 1 day (Intensive)',
    opt_day_2: 'Finish every 2 days',
    opt_day_3: 'Finish every 3 days',
    opt_day_4: 'Finish every 4 days',
    opt_day_5: 'Finish every 5 days',
    opt_day_6: 'Finish every 6 days (Recommended)',
    hint_murajaah_days: 'The system automatically calculates and divides revision pages to finish on the last day.',
    btn_submit_register: 'Create Account',
    btn_submit_login: 'Sign In',
    auth_welcome_toast: 'Account created successfully! Welcome 📖',
    auth_login_toast: 'Signed in successfully ✓',

    // Common Toasts & Labels
    toast_theme_light: 'Switched to Light mode ☀️',
    toast_theme_dark: 'Switched to Dark mode 🌙',
    toast_sound_on: 'Sound feedback enabled 🔊',
    toast_sound_off: 'Sound feedback muted 🔇',
    toast_wake_on: 'Keep Screen Awake enabled 💡',
    toast_wake_off: 'Keep Screen Awake disabled',
    juz_label: 'Juz {num}',
    hizb_label: 'Hizb {num}',
    rub_label: 'Rub el Hizb {num}',
    ayah_label: 'Ayah {num}',
    surah_prefix: 'Surah ',
    page_prefix: 'Page ',
    err_network: 'Could not connect to server. Please check your connection.',
    err_session_expired: 'Session expired. Please sign in again.',
    err_unexpected: 'An unexpected error occurred.',
  }
};

const I18N = {
  lang: 'ar',
  dictionary: I18N_DICTIONARY,
  listeners: [],

  init() {
    try {
      this.lang = localStorage.getItem('hifz-lang') || 'ar';
    } catch (e) {
      this.lang = 'ar';
    }
    this.apply(this.lang, false);
    this.bindButtons();
  },

  t(key, params = {}) {
    const dict = I18N_DICTIONARY[this.lang] || I18N_DICTIONARY.ar;
    let str = dict[key] !== undefined ? dict[key] : (I18N_DICTIONARY.ar[key] !== undefined ? I18N_DICTIONARY.ar[key] : key);
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => {
        str = String(str).replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      });
    }
    return str;
  },

  getSurah(id) {
    return SURAHS_DATA.find((s) => s.id === parseInt(id, 10)) || null;
  },

  getSurahName(id) {
    const s = this.getSurah(id);
    if (!s) return this.lang === 'en' ? `Surah ${id}` : `سورة ${id}`;
    return this.lang === 'en' ? s.name_en : s.name_ar;
  },

  getMistakeLabel(type) {
    const map = {
      TRANSITION_FAILURE: 'tag_transition',
      MUTASHABIHAT: 'tag_mutashabihat',
      TAWAQQUF: 'tag_tawaqquf',
      TASHKEEL: 'tag_tashkeel',
      LAFDH: 'tag_lafdh',
    };
    const key = map[type];
    return key ? this.t(key) : (type || '');
  },

  translateContainer(root = document) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = this.t(key);
    });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = this.t(key);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', this.t(key));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        const val = this.t(key);
        el.setAttribute('title', val);
        el.setAttribute('aria-label', val);
      }
    });
  },

  apply(newLang, triggerToast = true) {
    if (newLang instanceof Element || newLang instanceof Document || (newLang && newLang.nodeType)) {
      this.translateContainer(newLang);
      return;
    }
    if (typeof newLang !== 'string') return;
    this.lang = newLang === 'en' ? 'en' : 'ar';
    try {
      localStorage.setItem('hifz-lang', this.lang);
    } catch (e) {}

    const html = document.documentElement;
    html.setAttribute('lang', this.lang);
    html.setAttribute('dir', this.lang === 'ar' ? 'rtl' : 'ltr');

    this.translateDOM();
    this.updateControls();

    if (triggerToast && window.showToast) {
      window.showToast(this.t('lang_switched_toast'));
    }

    // Notify registered listeners
    this.listeners.forEach((fn) => {
      try { fn(this.lang); } catch (e) { console.error('i18n listener error:', e); }
    });
  },

  toggle() {
    const next = this.lang === 'ar' ? 'en' : 'ar';
    this.apply(next, true);
  },

  onChange(fn) {
    if (typeof fn === 'function') {
      this.listeners.push(fn);
    }
  },

  translateDOM() {
    // 1. Plain text elements
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key);
      }
    });

    // 2. HTML elements (bold, icons, etc.)
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) {
        el.innerHTML = this.t(key);
      }
    });

    // 3. Input placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', this.t(key));
      }
    });

    // 4. Element titles & ARIA labels
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        const val = this.t(key);
        el.setAttribute('title', val);
        el.setAttribute('aria-label', val);
      }
    });
  },

  updateControls() {
    const isEn = this.lang === 'en';

    // Update all language toggle buttons
    document.querySelectorAll('.lang-toggle-btn').forEach((btn) => {
      const badge = btn.querySelector('.lang-code-text, .lang-badge');
      if (badge) {
        badge.textContent = isEn ? 'عربي' : 'EN';
      }
      btn.title = isEn ? 'تبديل اللغة إلى العربية' : 'Switch language to English';
      btn.setAttribute('aria-label', btn.title);
    });

    // Update menu dropdown item text
    const menuLangSpan = document.querySelector('#btn-menu-lang [data-i18n="menu_lang_toggle"]');
    if (menuLangSpan) {
      menuLangSpan.textContent = this.t('menu_lang_toggle');
    }
  },

  bindButtons() {
    document.querySelectorAll('.lang-toggle-btn').forEach((btn) => {
      if (!btn._langBound) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggle();
        });
        btn._langBound = true;
      }
    });
  }
};

// Expose globally
window.I18N = I18N;
window.SURAHS_DATA = SURAHS_DATA;
window.t = (key, params) => I18N.t(key, params);

// Apply initial language & direction immediately
try {
  const initialLang = localStorage.getItem('hifz-lang') || 'ar';
  document.documentElement.setAttribute('lang', initialLang);
  document.documentElement.setAttribute('dir', initialLang === 'en' ? 'ltr' : 'rtl');
} catch (e) {}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => I18N.init());
} else {
  I18N.init();
}
