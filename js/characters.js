// Persistent facial anatomy and temperament, independent of the dish being served.
// Even two of the same dish keep their own eyes, timing and response to each gesture.
export const CHARACTERS = {
  mochi: {
    face: { eyeX: .34, eyeW: 1.1, eyeH: 1.04, iris: '#634127', gloss: '#AC7846', mark: 'freckles', blush: .12 },
    blink: [2.5,4.4], blinkSpeed: 1, doubleBlink: .15, gaze: 8, energy: .75, quirks: [4,8],
    reactions: { hover:'happy', picking:'excited', pinch:'squint', lifted:'happy', held:'love', dip:'curious', dipped:'love', approach:'happy', bitten:'surprised', putback:'giggle', watch:'excited' },
  },
  pip: {
    face: { eyeX: .39, eyeW: .9, eyeH: 1.25, asymmetry: .17, iris: '#554628', gloss: '#99834A', mark: 'nose-freckles', blush: -.05 },
    blink: [1.7,3.2], blinkSpeed: .75, doubleBlink: .65, gaze: 13, energy: .65, quirks: [3,6],
    reactions: { hover:'curious', picking:'curious', pinch:'wink', lifted:'surprised', held:'curious', dip:'curious', dipped:'surprised', approach:'curious', bitten:'dizzy', putback:'curious', watch:'curious' },
  },
  dumpy: {
    face: { eyeX: .38, eyeW: 1.25, eyeH: .69, iris: '#665342', gloss: '#96816A', mark: 'sleep-lines', blush: -.1 },
    blink: [4,7], blinkSpeed: 1.7, doubleBlink: 0, gaze: 3.4, energy: .22, quirks: [6,11],
    reactions: { hover:'sleepy', picking:'sleepy', pinch:'squint', lifted:'sleepy', held:'sleepy', dip:'sleepy', dipped:'happy', approach:'sleepy', bitten:'surprised', putback:'sleepy', watch:'sleepy' },
  },
  bao: {
    face: { eyeX: .32, eyeW: 1.08, eyeH: .9, asymmetry: .1, iris: '#513526', gloss: '#8C5E3E', mark: 'beauty-spot', blush: .03 },
    blink: [2.2,4], blinkSpeed: .85, doubleBlink: .3, gaze: 10, energy: .95, quirks: [3,7],
    reactions: { hover:'wink', picking:'cheeky', pinch:'wink', lifted:'cheeky', held:'cheeky', dip:'wink', dipped:'silly', approach:'cheeky', bitten:'wink', putback:'cheeky', watch:'giggle' },
  },
  pudding: {
    face: { eyeX: .3, eyeW: .79, eyeH: 1.2, iris: '#6A3E3A', gloss: '#A9726A', mark: 'blush-lines', lashes: true, blush: .28 },
    blink: [1.8,3.8], blinkSpeed: 1.15, doubleBlink: .5, gaze: 5, energy: .35, quirks: [4,8],
    reactions: { hover:'shy', picking:'worried', pinch:'squint', lifted:'shy', held:'shy', dip:'worried', dipped:'love', approach:'shy', bitten:'surprised', putback:'shy', watch:'worried' },
  },
  nori: {
    face: { eyeX: .42, eyeW: .92, eyeH: .74, iris: '#3E3F2E', gloss: '#797955', mark: 'brows', blush: -.18 },
    blink: [3.5,6], blinkSpeed: 1.2, doubleBlink: .05, gaze: 5.5, energy: .32, quirks: [5,9],
    reactions: { hover:'grumpy', picking:'grumpy', pinch:'grumpy', lifted:'grumpy', held:'grumpy', dip:'grumpy', dipped:'nom', approach:'grumpy', bitten:'grumpy', putback:'grumpy', watch:'grumpy' },
  },
  suki: {
    face: { eyeX: .37, eyeW: 1.18, eyeH: 1.22, iris: '#6B4128', gloss: '#BB813E', mark: 'sparkle-cheeks', blush: .12 },
    blink: [1.4,2.7], blinkSpeed: .7, doubleBlink: .5, gaze: 14, energy: 1.2, quirks: [2.5,5],
    reactions: { hover:'excited', picking:'excited', pinch:'giggle', lifted:'excited', held:'excited', dip:'excited', dipped:'love', approach:'excited', bitten:'dizzy', putback:'happy', watch:'excited' },
  },
  momo: {
    face: { eyeX: .35, eyeW: .97, eyeH: 1.12, asymmetry: .28, iris: '#594137', gloss: '#A77C62', mark: 'one-freckle', blush: .04 },
    blink: [2,4.5], blinkSpeed: .95, doubleBlink: .4, gaze: 7, energy: 1.1, quirks: [3,6],
    reactions: { hover:'silly', picking:'silly', pinch:'squint', lifted:'dizzy', held:'silly', dip:'cheeky', dipped:'silly', approach:'silly', bitten:'dizzy', putback:'silly', watch:'silly' },
  },
};
export const characterFor = id => CHARACTERS[id] || CHARACTERS.mochi;

// Each character has a small voice in all three languages. Crowd lines react to friends.
export const CHARACTER_LINES = {
  mochi: {
    hover: {vi:['Chọn tớ, tớ sẵn sàng!'],en:['Pick me, I’m ready!'],zh:['选我，我准备好啦！']},
    lifted: {vi:['Ôm bằng đũa cũng vui!'],en:['A chopstick hug!'],zh:['筷子的抱抱！']},
    dipped: {vi:['Có nước tương, có niềm vui!'],en:['A little dip of happiness!'],zh:['蘸一点快乐！']},
    putback: {vi:['Lát chơi tiếp nha!'],en:['Let’s play again soon!'],zh:['一会儿再玩哦！']},
    watch: {vi:['Bạn làm được mà!'],en:['You’ve got this!'],zh:['你可以的！']},
  },
  pip: {
    hover: {vi:['Ngoài xửng có gì nhỉ?'],en:['What’s beyond the steamer?'],zh:['蒸笼外面有什么呀？']},
    lifted: {vi:['Ồ! Nhìn xa ghê!'],en:['Oh! What a view!'],zh:['哇，看得好远！']},
    dipped: {vi:['Ra nước tương vị này!'],en:['So that’s what soy tastes like!'],zh:['原来酱油是这个味道！']},
    putback: {vi:['Tớ có chuyện kể nè!'],en:['I have so many questions!'],zh:['我有好多问题！']},
    watch: {vi:['Rồi sao nữa nhỉ?'],en:['What happens next?'],zh:['接下来会怎样呢？']},
  },
  dumpy: {
    hover: {vi:['Cho tớ ngủ thêm xíu…'],en:['Five more minutes…'],zh:['再睡五分钟…']},
    lifted: {vi:['Đến nơi nhớ gọi tớ…'],en:['Wake me when we get there…'],zh:['到了再叫我…']},
    dipped: {vi:['Tắm xong ngủ tiếp…'],en:['Bath, then back to bed…'],zh:['洗完澡接着睡…']},
    putback: {vi:['Ừm… gối của tớ…'],en:['Mmm… my pillow…'],zh:['嗯…我的枕头…']},
    watch: {vi:['Ăn nhỏ tiếng thôi…'],en:['Keep the chewing down…'],zh:['小声一点嚼哦…']},
  },
  bao: {
    hover: {vi:['Thấy tớ đẹp chưa?'],en:['Like what you see?'],zh:['是不是很可爱？']},
    lifted: {vi:['Nhớ chụp góc đẹp nha!'],en:['Get my good side!'],zh:['记得拍我好看的一面！']},
    dipped: {vi:['Áo nước tương mới nè!'],en:['How’s my new soy coat?'],zh:['我的酱油新衣怎么样？']},
    putback: {vi:['Nhớ tớ rồi đúng không?'],en:['Miss me already?'],zh:['已经想我啦？']},
    watch: {vi:['Tớ diễn hay hơn cơ!'],en:['I could do that better.'],zh:['我能表演得更好！']},
  },
  pudding: {
    hover: {vi:['Ơ… bạn chọn tớ á?'],en:['Oh… you mean me?'],zh:['啊…你选我吗？']},
    lifted: {vi:['Nhẹ tay… nhé…'],en:['Gently… please…'],zh:['轻一点…好吗…']},
    dipped: {vi:['Hơi ngại… mà ngon…'],en:['A little shy… a little saucy…'],zh:['有点害羞…有点香…']},
    putback: {vi:['Cảm ơn bạn nha…'],en:['Thank you for bringing me home…'],zh:['谢谢你送我回家…']},
    watch: {vi:['Tớ nhìn một chút thôi…'],en:['I’ll just peek…'],zh:['我就偷偷看一下…']},
  },
  nori: {
    hover: {vi:['Tớ đang nghỉ mà.'],en:['I was perfectly comfortable.'],zh:['我正待得好好的呢。']},
    lifted: {vi:['Tớ chưa đồng ý nhé.'],en:['I did not agree to this.'],zh:['我可还没同意呢。']},
    dipped: {vi:['Hừm. Cũng… được.'],en:['Hmph. That’s… acceptable.'],zh:['哼。也…还行吧。']},
    putback: {vi:['Đúng chỗ tớ đấy.'],en:['Exactly where I was, please.'],zh:['请放回我原来的位置。']},
    watch: {vi:['Làm quá lên thôi.'],en:['So dramatic.'],zh:['真爱演。']},
  },
  suki: {
    hover: {vi:['Tớ tớ tớ!'],en:['Me me me!'],zh:['我我我！']},
    lifted: {vi:['Bay lên nàoooo!'],en:['Wheeee! Higher!'],zh:['飞起来啦！再高一点！']},
    dipped: {vi:['Cầu trượt nước tương!'],en:['Soy-sauce waterslide!'],zh:['酱油滑水道！']},
    putback: {vi:['Lần nữa, lần nữa!'],en:['Again, again!'],zh:['再来一次，再来一次！']},
    watch: {vi:['Tuyệt quá đi!!!'],en:['That was AMAZING!'],zh:['太棒啦！！！']},
  },
  momo: {
    hover: {vi:['Bánh này biết lè lưỡi!'],en:['Bet you can’t do this!'],zh:['你会做这个鬼脸吗？']},
    lifted: {vi:['Ú òa! Tớ bay được!'],en:['Surprise! I can fly!'],zh:['嘿！我会飞啦！']},
    dipped: {vi:['Tớ thành bánh cá rồi!'],en:['Look, I’m a soy submarine!'],zh:['看，我是酱油潜水艇！']},
    putback: {vi:['Tớ chưa đi đâu hết nha!'],en:['You saw absolutely nothing.'],zh:['你什么都没看见哦。']},
    watch: {vi:['Măm măm… ủa chưa tới tớ!'],en:['Nom nom… oh, not my turn!'],zh:['啊呜…哦，还没轮到我！']},
  },
};

export const DISH_TASTES = {
  xiaolongbao: {vi:['Ôi, nước súp tràn vị!'],en:['A little burst of broth!'],zh:['一口满满的汤汁！']},
  jiaozi: {vi:['Vỏ mềm, nhân thơm!'],en:['A soft little crescent!'],zh:['皮软馅香的小月牙！']},
  potsticker: {vi:['Giòn rụm luôn!'],en:['Those crispy golden edges!'],zh:['金黄的脆边！']},
  hargow: {vi:['Tôm ngọt, vỏ trong veo!'],en:['Sweet shrimp, silky wrapper!'],zh:['鲜甜的虾，晶莹的皮！']},
  siumai: {vi:['Một miếng, đầy vị!'],en:['One golden bite, so much flavour!'],zh:['一口金黄，满满鲜香！']},
  bao: {vi:['Mềm như mây, thơm xá xíu!'],en:['A fluffy little cloud of barbecue!'],zh:['像云朵一样软的叉烧包！']},
};

// The mixed basket has a recognisable cast; extra pieces draw from the remaining characters.
export const TYPE_CHARACTERS = { xiaolongbao:'mochi', jiaozi:'pip', potsticker:'nori', hargow:'pudding', siumai:'suki', bao:'dumpy' };
