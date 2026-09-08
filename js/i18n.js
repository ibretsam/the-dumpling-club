import { CHARACTER_LINES, DISH_TASTES } from './characters.js';
// One shared locale for the physical menu, DOM, character voices and accessibility text.
export const LANGUAGES = ['vi', 'en', 'zh'];
const STORAGE_KEY = 'dumpling-club.language';
let language = 'vi';
try { const saved = localStorage.getItem(STORAGE_KEY); if (LANGUAGES.includes(saved)) language = saved; } catch { /* Storage may be unavailable in private browsers. */ }
export const getLanguage = () => language;
export function setLanguage(next) {
  if (!LANGUAGES.includes(next) || next === language) return false;
  language = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* The current visit still switches. */ }
  return true;
}

export const DISH_NAMES = {
  xiaolongbao: { vi: 'Tiểu long bao', en: 'Xiaolongbao', zh: '小笼包' },
  jiaozi: { vi: 'Sủi cảo', en: 'Jiaozi', zh: '饺子' },
  potsticker: { vi: 'Sủi cảo áp chảo', en: 'Potsticker', zh: '锅贴' },
  hargow: { vi: 'Há cảo tôm', en: 'Har gow', zh: '虾饺' },
  siumai: { vi: 'Xíu mại', en: 'Siu mai', zh: '烧卖' },
  bao: { vi: 'Bánh bao xá xíu', en: 'Char siu bao', zh: '叉烧包' },
  assorted: { vi: 'Xửng thập cẩm', en: 'Chef’s basket', zh: '点心拼盘' },
};
export const dishName = (id, locale = language) => DISH_NAMES[id]?.[locale] || id;
export const menuNames = id => [language, ...LANGUAGES.filter(l => l !== language)].map(lang => ({ lang, text: dishName(id,lang) }));

export const COPY = {
  play: { vi: 'Bắt đầu', en: 'Play', zh: '开始' },
  eyebrow: { vi: 'Điểm tâm · Dim sum · 点心', en: 'Dim sum · Điểm tâm · 点心', zh: '点心 · Dim sum · Điểm tâm' },
  tagline: { vi: 'Cầm đũa, chọn bánh, chấm nước tương và thưởng thức.', en: 'Pick up the chopsticks, choose a dumpling, dip it and enjoy.', zh: '拿起筷子，选一个点心，蘸上酱油，慢慢享用。' },
  anotherRound: { vi: 'Thêm một xửng', en: 'Another round', zh: '再来一笼' },
  language: { vi: 'Ngôn ngữ', en: 'Language', zh: '语言' },
  sound: { vi: 'Âm thanh', en: 'Sound', zh: '声音' },
  menu: { vi: 'Điểm tâm', en: 'Dim sum', zh: '点心' },
  pieces: { vi: 'SỐ CÁI', en: 'PIECES', zh: '数量' },
  portion: { vi: '{n} cái', en: '{n} pieces', zh: '{n}个' },
  loading: { vi: 'Đang làm nóng xửng…', en: 'Warming the steamer…', zh: '蒸笼正在预热…' },
  sceneLabel: { vi: 'Quầy điểm tâm tương tác', en: 'Interactive dim sum stall', zh: '互动点心小摊' },
  welcome: { vi: 'The Dumpling Club. Nhấn Enter để bắt đầu.', en: 'The Dumpling Club. Press Enter to play.', zh: 'The Dumpling Club。按回车键开始。' },
  guideMenu: { vi: 'Chọn một món trên thực đơn nhé.', en: 'Choose a dish on the menu.', zh: '在菜单上选一道点心吧。' },
  guideIdle: { vi: 'Cầm đũa lên để bắt đầu nhé.', en: 'Pick up the chopsticks to begin.', zh: '先拿起筷子吧。' },
  guideChoose: { vi: 'Chọn một chiếc bánh · Chạm gác đũa để đặt xuống.', en: 'Choose a dumpling · Tap the holder to rest.', zh: '选一个点心 · 点击筷架放下筷子。' },
  guideRest: { vi: 'Chạm gác đũa để đặt bánh và đũa xuống.', en: 'Tap the holder to put everything back.', zh: '点击筷架，放回点心和筷子。' },
  guideCarry: { vi: 'Chấm nước tương · Trả về xửng · Chạm chỗ khác để ăn.', en: 'Sauce to dip · Steamer to return · Elsewhere to eat.', zh: '点酱碟蘸酱 · 点蒸笼放回 · 点其他地方吃掉。' },
  menuHelp: { vi: 'Chọn món trên thực đơn gỗ. Dùng phím mũi tên để chọn, Enter để gọi món. Nhấn 3, 5 hoặc 8 để chọn số lượng.', en: 'Choose a dish on the wooden menu. Arrow keys to choose, Enter to order. 3, 5 or 8 for portion size.', zh: '在木菜单上选一道点心。方向键选择，回车键下单，按3、5或8选择数量。' },
  carryHelp: { vi: 'Chạm nước tương để chấm, xửng để trả bánh, gác đũa để đặt đũa xuống, hoặc chỗ khác để ăn. D để chấm, B để ăn, Escape để trả bánh.', en: 'Click the sauce to dip, the steamer to return the dumpling, the chopstick rest to put everything back, or elsewhere to eat. D dips, B eats, Escape puts back.', zh: '点击酱碟蘸酱、蒸笼放回点心、筷架放回筷子，或其他地方吃掉。D蘸酱，B吃掉，Esc放回。' },
  idleHelp: { vi: 'Cầm đũa lên trước nhé. Bạn cũng có thể nhấn Enter.', en: 'Pick up the chopsticks first. Enter also works.', zh: '先拿起筷子，也可以按回车键。' },
  chooseHelp: { vi: 'Chọn một chiếc bánh, hoặc chạm gác đũa để đặt đũa xuống. Bạn cũng có thể dùng Enter và phím mũi tên.', en: 'Choose a dumpling, or click the chopstick rest to put the sticks down. Enter and arrow keys also work.', zh: '选择一个点心，或点击筷架放下筷子。也可以使用回车键和方向键。' },
  emptyHelp: { vi: 'Hết bánh rồi! Chọn Thêm một xửng để quay về thực đơn, hoặc chạm xửng để gọi lại món vừa rồi.', en: 'The steamer is empty. Choose Another round to return to the menu, or tap the steamer to repeat your order.', zh: '点心吃完啦！选择“再来一笼”返回菜单，或点击蒸笼再来一份原来的点心。' },
  fresh: { vi: '{n} chiếc bánh nóng hổi đã sẵn sàng.', en: '{n} fresh dumplings are ready.', zh: '{n}个热腾腾的点心做好啦。' },
  soundOn: { vi: 'Đã bật âm thanh.', en: 'Sound on.', zh: '声音已开启。' },
  soundOff: { vi: 'Đã tắt âm thanh.', en: 'Sound muted.', zh: '声音已关闭。' },
  autoplayOn: { vi: 'Đã bật chế độ tự chơi.', en: 'Autoplay on.', zh: '自动模式已开启。' },
  autoplayOff: { vi: 'Đã tắt chế độ tự chơi.', en: 'Autoplay off.', zh: '自动模式已关闭。' },
  recording: { vi: 'Đang quay', en: 'Recording', zh: '正在录制' },
  saving: { vi: 'Đang lưu', en: 'Saving', zh: '正在保存' },
  recorded: { vi: 'Đã quay xong.', en: 'Recording finished.', zh: '录制完成。' },
  recordNote: { vi: '1080 × 1080 · 30 fps · Lưu trên thiết bị khi quay xong', en: '1080 × 1080 · 30 fps · Saved locally when done', zh: '1080 × 1080 · 30 fps · 完成后保存到本机' },
  recordUnsupported: { vi: 'Trình duyệt này chưa hỗ trợ quay video.', en: 'Recording is not supported in this browser.', zh: '此浏览器不支持录制。' },
  sitFirst: { vi: 'Hãy đến bàn trước nhé.', en: 'Sit down at the table first.', zh: '请先入座。' },
  waitBite: { vi: 'Chờ ăn xong miếng này nhé.', en: 'One moment — let the current bite finish.', zh: '稍等，先吃完这一口。' },
  windowSmall: { vi: 'Cửa sổ quá nhỏ để quay video.', en: 'The window is too small to record.', zh: '窗口太小，无法录制。' },
  recordFailed: { vi: 'Không thể bắt đầu quay trong trình duyệt này.', en: 'Could not start recording in this browser.', zh: '无法在此浏览器中开始录制。' },
  saved: { vi: 'Đã lưu {file} ({mb} MB, 1080 × 1080, 30 fps)', en: 'Saved {file} ({mb} MB, 1080 × 1080, 30 fps)', zh: '已保存 {file}（{mb} MB，1080 × 1080，30 fps）' },
  savedAnnouncement: { vi: 'Đã lưu video: {file}', en: 'Video saved as {file}', zh: '视频已保存为 {file}' },
  recordEmpty: { vi: 'Video bị trống. Hãy thử lại hoặc dùng trình duyệt khác.', en: 'The recording came back empty. Try again, or use a different browser.', zh: '录制的视频为空。请重试或换一个浏览器。' },
  error: { vi: 'Không thể mở quầy điểm tâm. Vui lòng tải lại trang.', en: 'The stall could not open. Please reload the page.', zh: '点心摊无法打开，请刷新页面。' },
  sceneGuide: {
    vi: 'Bắt đầu sẽ mở thực đơn gỗ. Dùng phím mũi tên chọn món, 3, 5 hoặc 8 chọn số lượng, Enter để gọi món. Tại bàn, chạm đũa trước rồi chọn bánh. Chạm nước tương để chấm, xửng để trả bánh, gác đũa để đặt đũa xuống, hoặc chỗ khác để ăn. Phím tắt: Enter cầm đũa và chọn bánh; D chấm; B ăn; Escape trả bánh hoặc đặt đũa xuống; O mở thực đơn; R gọi lại món; M bật tắt âm thanh. V quay một lượt ăn, Escape dừng quay.',
    en: 'Play opens the wooden menu. Use arrow keys to choose a dish, 3, 5 or 8 for the portion, and Enter to order. At the table, click the chopsticks first, then a dumpling. Click sauce to dip, steamer to return the food, holder to rest the sticks, or elsewhere to eat. Keyboard: Enter to pick, arrows to choose, D to dip, B to eat, Escape to put back, O for menu, R to refill, M to mute. V records a bite; Escape stops recording.',
    zh: '开始后会打开木菜单。用方向键选择点心，按3、5或8选择数量，按回车键下单。入座后先点击筷子，再选点心。点击酱碟蘸酱、蒸笼放回点心、筷架放下筷子，或其他地方吃掉。快捷键：回车拿起，方向键选择，D蘸酱，B吃掉，Esc放回，O打开菜单，R再来一份，M切换声音，V录制，Esc停止录制。',
  },
};
export function t(key, vars = {}) { return (COPY[key]?.[language] || key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)); }
export const menuHeading = () => [language, ...LANGUAGES.filter(l=>l!==language)].map(lang => ({lang,text:COPY.menu[lang]}));

export const VOICES = {
  hover: { vi: ['Tớ á?', 'Chào bạn nha!', 'Chọn tớ nè!', 'Cẩn thận, tớ còn nóng!', 'Đến lượt tớ chưa?'], en: ['Me? Oh!', 'Hello there.', 'Pick me!', 'Careful, I’m warm.', 'Is it my turn?'], zh: ['是我吗？', '你好呀！', '选我吧！', '小心，我还烫呢！', '轮到我了吗？'] },
  poke: { vi: ['Hihi, nhột quá!', 'Ấy da!', 'Đừng chọc tớ nữa!', 'Lấy đũa đi chứ!'], en: ['Hehe, that tickles!', 'Oof!', 'No poking!', 'Use the chopsticks!'], zh: ['嘻嘻，好痒！', '哎呀！', '别戳我啦！', '用筷子呀！'] },
  picking: { vi: ['Tớ thật á?!'], en: ['Me?!'], zh: ['真的是我？！'] },
  lifted: { vi: ['Ối!', 'Bám chắc nha!', 'Bay lên nào!', 'Nhẹ tay thôi nhé!'], en: ['Eep!', 'Hold on tight!', 'Whoa, up I go.', 'Be gentle!'], zh: ['呀！', '抓稳啦！', '我飞起来啦！', '轻一点哦！'] },
  picked: { vi: ['Dũng cảm lên!', 'Chúc may mắn nha!', 'Đừng chọn tớ tiếp nhé…'], en: ['Be brave!', 'Good luck, friend.', 'Not me next…'], zh: ['勇敢一点！', '祝你好运！', '下一个别选我呀…'] },
  dipped: { vi: ['Ôi, đậm đà quá!', 'Sang ghê!', 'Tõm!', 'Chừa tớ chút nha!'], en: ['Ooh, saucy.', 'Fancy.', 'Splash!', 'Save some for me!'], zh: ['好香的酱汁！', '真讲究！', '扑通！', '给我留一点！'] },
  bitten: { vi: ['!!!', 'Có mọng nước không?', 'Ôi trời!', 'Nhai từ từ nhé!'], en: ['!!!', 'Was it… juicy?', 'Oh my.', 'Chew politely!'], zh: ['！！！', '汤汁多吗？', '天哪！', '慢慢嚼哦！'] },
  eaten: { vi: ['Huyền thoại luôn!', 'Ngon hết ý!', 'Ai tiếp theo nào?', 'Măm măm măm.'], en: ['A legend.', 'Chef’s kiss.', 'Who’s next?', 'Nom nom nom.'], zh: ['真是传奇！', '太好吃啦！', '下一个是谁？', '啊呜啊呜。'] },
  putback: { vi: ['Phù…', 'Về nhà rồi!', 'Hú hồn luôn.'], en: ['Phew.', 'Home sweet steamer.', 'That was close.'], zh: ['呼…', '回家真好。', '好险呀。'] },
  tasteDipped: { vi: ['Mọng nước quá!', 'Chấm vừa ngon!', 'Thơm vị nước tương!', 'Ngon hết ý!', 'Đậm đà quá!', 'Mềm tan trong miệng.'], en: ['So juicy!', 'Perfect dip.', 'Mmm, soy heaven.', 'Chef’s kiss.', 'That’s the good stuff.', 'Salty, silky, soft.'], zh: ['好多汁！', '蘸得刚刚好！', '酱香真浓！', '太美味啦！', '就是这个味道！', '咸香又软糯。'] },
  tastePlain: { vi: ['Không chấm vẫn ngon!', 'Mộc mạc mà ngon.', 'Hấp vừa tới!', 'Mềm quá đi!', 'Mềm như mây.'], en: ['Naked, but perfect.', 'Pure and simple.', 'Steamed just right.', 'So soft!', 'Clouds for dinner.'], zh: ['不蘸也好吃！', '原汁原味。', '蒸得刚刚好。', '好软呀！', '像在吃云朵。'] },
  tasteSecond: { vi: ['Măm măm măm.', 'Hai miếng là hết!', 'Ăn sạch luôn.', 'Hết rồi nè!'], en: ['Nom nom nom.', 'Gone in two.', 'All of it.', 'And… done.'], zh: ['啊呜啊呜。', '两口吃光！', '全吃完啦。', '吃完喽！'] },
};
export function voice(event, personality, dish) {
  const key = event === 'picking' ? 'hover' : ['picked','bitten','eaten'].includes(event) ? 'watch' : event;
  const choices = (dish && ['tastePlain','tasteDipped'].includes(event) ? DISH_TASTES[dish]?.[language] : null)
    || CHARACTER_LINES[personality]?.[key]?.[language] || VOICES[event]?.[language] || VOICES.hover[language];
  return choices[Math.floor(Math.random()*choices.length)];
}
