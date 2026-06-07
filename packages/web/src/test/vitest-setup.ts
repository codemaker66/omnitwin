type ThreeDevWindow = Window & {
  __THREE__?: string;
};

delete (window as ThreeDevWindow).__THREE__;
