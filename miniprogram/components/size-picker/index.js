Component({
  properties: {
    value: { type: String, value: '1024x1024' },
  },

  data: {
    displaySizes: [],
    sizes: [
      { value: '1024x1024', label: '正方形', desc: '1024×1024', rectStyle: 'width:40rpx;height:40rpx;' },
      { value: '1536x1024', label: '横版', desc: '1536×1024', rectStyle: 'width:56rpx;height:36rpx;' },
      { value: '1024x1536', label: '竖版', desc: '1024×1536', rectStyle: 'width:36rpx;height:56rpx;' },
      { value: '2048x2048', label: '2K 正方', desc: '2048×2048', rectStyle: 'width:44rpx;height:44rpx;' },
      { value: '3840x2160', label: '4K 横版', desc: '3840×2160', rectStyle: 'width:60rpx;height:34rpx;' },
    ],
  },

  lifetimes: {
    attached() {
      this.syncDisplaySizes(this.properties.value);
    },
  },

  observers: {
    value(value) {
      this.syncDisplaySizes(value);
    },
  },

  methods: {
    syncDisplaySizes(value) {
      const displaySizes = this.data.sizes.map(item => ({
        ...item,
        activeClass: item.value === value ? 'size-active' : '',
      }));
      this.setData({ displaySizes });
    },

    onSelect(e) {
      const size = e.currentTarget.dataset.size;
      this.setData({ value: size });
      this.syncDisplaySizes(size);
      this.triggerEvent('change', { value: size });
    },
  },
});
