import { fireEvent } from "@testing-library/react";

/**
 * Press Enter in a form's single-line field, as a browser does.
 *
 * Enter there submits the form through its default button, the first submit
 * button in the form (HTML "implicit submission"), and focus stays in the
 * field. happy-dom does not implement implicit submission, so this takes the
 * same steps: focus the field, Enter down, then a click on the default button
 * that does not move focus. The form's own validation still decides, as the
 * button's click does in happy-dom and in a browser.
 */
export function pressEnterIn(field: HTMLInputElement): void {
  field.focus();
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  const submitters = field.form === null ? [] : [...field.form.elements];
  const defaultButton = submitters.find(
    (element): element is HTMLButtonElement | HTMLInputElement =>
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === "submit",
  );
  if (defaultButton === undefined) throw new Error("Enter submits only a form that has a submit button");
  fireEvent.click(defaultButton);
}
