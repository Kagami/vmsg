import React from "react";
import ReactDOM from "react-dom";
import vmsg from "..";

// https://github.com/parcel-bundler/parcel/issues/289
if (module.hot) {
  module.hot.dispose(() => {
    location.reload();
  });
}

class Post extends React.Component {
  render() {
    return (
      <article className="post">
        <h3 className="post__header">Example post</h3>
        <section className="post__body">
          So here is a simple demo of <a href="https://github.com/Kagami/vmsg">vmsg library</a>. Imagine this is a blog post or forum thread. Below you can leave text comments, as usual. But there is one more button: “Record”. If you press it vmsg library will open you a microphone recording form. Resulting record will automatically be encoded to MP3 so file won't weight too much. So you can easily share your voice messages even on mobile network and server needs to neither waste CPU time by encoding to MP3 by itself nor using a lot of disk space to store records.
        </section>
        <Comments />
      </article>
    );
  }
}

class Comments extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      comments: [],
    };
    this.idCounter = 0;
  }
  handleReplySend = (comment) => {
    const { comments } = this.state;
    comment = { ...comment, id: this.idCounter++ };
    this.setState({comments: comments.concat(comment)});
  };
  render() {
    const { comments } = this.state;
    return (
      <aside className="comments">
        {comments.map(props =>
          <Comment key={props.id} {...props} />
        )}
        <Reply onSend={this.handleReplySend} />
      </aside>
    );
  }
}

class Comment extends React.Component {
  constructor(props) {
    super(props);
    if (props.record) {
      this.audio = new Audio();
      this.audio.src = URL.createObjectURL(props.record);
    }
  }
  handleRecordOver = () => {
    this.audio.currentTime = 0;
    this.audio.play();
  };
  handleRecordOut = () => {
    this.audio.pause();
  };
  handleRecordClick = () => {
    const a = document.createElement("a");
    a.href = this.audio.src;
    a.download = "record.mp3";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  render() {
    const { id, body } = this.props;
    return (
      <article className="comment">
        <header className="comment__header">
          <h5 className="comment__id">
            Comment #{id + 1}
          </h5>
          {this.renderRecord()}
        </header>
        <blockquote className="comment__body">
          {body}
        </blockquote>
      </article>
    );
  }
  renderRecord() {
    const { record } = this.props;
    if (!record) return null;
    return (
      <span
        className="comment__record"
        title="Hover to play / click to download"
        onMouseOver={this.handleRecordOver}
        onMouseOut={this.handleRecordOut}
        onClick={this.handleRecordClick}
      >
        ♫
      </span>
    )
  }
}

class Reply extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      body: "",
      record: null,
    };
  }
  handleBodyChange = (e) => {
    this.setState({body: e.target.value});
  };
  handleRecord = () => {
    vmsg.record({
      wasmURL: require("../vmsg.wasm"),
      shimURL: "https://unpkg.com/wasm-polyfill.js@0.2.0/wasm-polyfill.js",
    }).then(record => {
      this.setState({record});
    });
  };
  handleSend = () => {
    const { body, record } = this.state;
    this.setState({body: "", record: null});
    this.props.onSend({body, record});
  };
  render() {
    const { body, record } = this.state;
    return (
      <article className="reply">
        <textarea
          className="reply__body"
          placeholder="Enter your comment here…"
          autoFocus
          value={body}
          onChange={this.handleBodyChange}
        />
        <footer className="reply__controls">
          <button className="reply-control" disabled={!body} onClick={this.handleSend}>
            Send
          </button>
          <button className="reply-control" onClick={this.handleRecord}>
            Record
          </button>
          {this.renderRecord()}
        </footer>
      </article>
    );
  }
  renderRecord() {
    const { record } = this.state;
    if (!record) return null;
    const size = (record.size / 1024).toFixed(1) + "KB";
    return (
      <span className="reply-record">
        record.mp3 ({size})
      </span>
    );
  }
}

ReactDOM.render(<Post/>, document.querySelector(".app"));
